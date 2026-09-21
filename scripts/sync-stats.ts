/**
 * Sync Schillerkiez demographic & social data from XLSX sources into MongoDB.
 *
 * Usage:
 *   pnpm tsx scripts/sync-stats.ts           # full sync
 *   pnpm tsx scripts/sync-stats.ts --dry-run  # parse only, no DB writes
 *
 * Environment variables:
 *   MONGODB_URI      — MongoDB connection string (required)
 *   STATS_XLSX_URL   — AfS demographics XLSX URL (required)
 *   STATS_PERIOD     — e.g. "2025h2" (required)
 *   MSS_XLSX_URL     — MSS social index XLSX URL (optional)
 *   MSS_PERIOD       — e.g. "2023" (optional, required if MSS_XLSX_URL set)
 *   MSS_SDI_URL      — MSS SDI XLSX URL (optional, for Status/Dynamik index)
 *   MSS_BEZIRKE_XLSX_URL — MSS Bezirke-level share table URL (optional, for Berlin/Neukölln reference)
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { afsImportProblems } from '../src/lib/kiez/syncChecks';
import ExcelJS from 'exceljs';

// Schillerkiez Planungsraum codes (2021 LOR system)
const PLR_CODES = ['08100102', '08100103', '08100104', '08100105'];

const isDryRun = process.argv.includes('--dry-run');

// ─── Helpers ────────────────────────────────────────────────────────

function cellValue(row: ExcelJS.Row, col: number): string | number | undefined {
  const cell = row.getCell(col);
  const v = cell.value;
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object' && 'result' in v) return (v as any).result;
  return v as string | number;
}

type DynamikClass = 'positiv' | 'stabil' | 'negativ';
/** SDI col 6: '+' → positiv, '+/-' (or '±', '0') → stabil, '-' → negativ. */
function parseDynamikClass(v: unknown): DynamikClass | undefined {
  const s = String(v ?? '').trim();
  if (s === '+') return 'positiv';
  if (s === '-' || s === '−') return 'negativ';
  if (s === '+/-' || s === '±' || s === '0') return 'stabil';
  return undefined;
}

function toNumber(v: string | number | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function findHeaderRow(sheet: ExcelJS.Worksheet, keywords: string[]): { rowNum: number; colMap: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r);
    const colMap = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = String(cell.value ?? '').trim().toUpperCase();
      if (text) colMap.set(text, colNumber);
    });
    const matched = keywords.filter(k => colMap.has(k.toUpperCase()));
    if (matched.length >= 2) {
      return { rowNum: r, colMap };
    }
  }
  return null;
}

function findSheet(workbook: ExcelJS.Workbook, keywords: string[], contentKeywords?: string[]): ExcelJS.Worksheet | null {
  // First try matching by sheet name
  for (const sheet of workbook.worksheets) {
    const name = sheet.name.toLowerCase();
    if (keywords.some(k => name.includes(k.toLowerCase()))) {
      return sheet;
    }
  }
  // Fall back to scanning sheet contents for header keywords (e.g. PLR column)
  if (contentKeywords) {
    for (const sheet of workbook.worksheets) {
      const header = findHeaderRow(sheet, contentKeywords);
      if (header) return sheet;
    }
  }
  return null;
}

/** A file that is not what we expect must END the run with exit code 1 — never
 *  a red cross followed by "✓ Sync complete" (that was the behaviour until
 *  2026-09-21; a scheduled run against a changed file stayed green). */
function fail(message: string): never {
  throw new Error(message);
}

async function downloadXlsx(url: string): Promise<ExcelJS.Workbook> {
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// ─── AfS Demographics Sync ─────────────────────────────────────────

interface DemographicsRow {
  plr_code: string;
  plr_name: string;
  total: number;
  male: number;
  female: number;
  u6: number;
  u18: number;
  u27: number;
  u45: number;
  u55: number;
  u65: number;
  a65: number;
  foreign_nationals: number;
  migration_background: number;
  single_person: number;
}

/**
 * Build full 8-digit PLR code from 4 LOR columns.
 * AfS XLSX uses columns: Bezirk(2), Prognoseraum(2), Bezirksregion(2), Planungsraum(2)
 */
function buildPlrCode(row: ExcelJS.Row): string {
  const bez = String(cellValue(row, 1) ?? '').trim().padStart(2, '0');
  const prog = String(cellValue(row, 2) ?? '').trim().padStart(2, '0');
  const bzr = String(cellValue(row, 3) ?? '').trim().padStart(2, '0');
  const plr = String(cellValue(row, 4) ?? '').trim().padStart(2, '0');
  return `${bez}${prog}${bzr}${plr}`;
}

/**
 * Find the first data row in an AfS sheet (skip header rows).
 * Data rows start when column 1 has a 2-digit Bezirk number.
 */
function findFirstDataRow(sheet: ExcelJS.Worksheet): number {
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const v = String(cellValue(sheet.getRow(r), 1) ?? '').trim();
    if (/^\d{1,2}$/.test(v)) return r;
  }
  return -1;
}

async function syncAfS(db: any) {
  const url = process.env.STATS_XLSX_URL;
  const period = process.env.STATS_PERIOD;
  if (!url || !period) {
    console.log('⚠ AfS sync skipped: STATS_XLSX_URL or STATS_PERIOD not set');
    return;
  }

  console.log('\n═══ AfS Demographics Sync ═══');
  const workbook = await downloadXlsx(url);
  console.log(`  Sheets: ${workbook.worksheets.map(s => s.name).join(', ')}`);

  // T2 has population by age + gender + Ausländer
  // T1 has population + migration background breakdown
  const t2 = workbook.getWorksheet('T2');
  const t1 = workbook.getWorksheet('T1');
  if (!t2) {
    fail('AfS: sheet "T2" not found — wrong report series? The import needs A I 16 (LOR-Planungsräume), not A I 5');
  }
  // Without T1 the origin figures would be stored as 0 and shown as a finding.
  if (!t1) fail('AfS: sheet "T1" (origin / migration background) not found');

  // T2 column layout (positional — verified from actual XLSX):
  // 1: Bezirk, 2: Prognoseraum, 3: Bezirksregion, 4: Planungsraum
  // 5: Insgesamt (total), 6: unter 6, 7: 6-15, 8: 15-18, 9: 18-27,
  // 10: 27-45, 11: 45-55, 12: 55-65, 13: 65+, 14: weiblich, 15: Ausländer
  const T2_COLS = { total: 5, u6: 6, u15: 7, u18: 8, u27: 9, u45: 10, u55: 11, u65: 12, a65: 13, female: 14, foreign: 15 };

  // T1 column layout:
  // 1-4: LOR codes, 5: Insgesamt (Anzahl), 6: % , 7: MH (Anzahl), 8: MH %
  // 9: Deutsche zusammen, 10: %, 11: ohne MH, 12: %, 13: mit MH, 14: %, 15: Ausländer, 16: %
  const T1_COLS = { total: 5, mh_count: 7, foreign: 15 };

  // Build PLR name lookup from Schlüssel sheet
  const nameMap = new Map<string, string>();
  const schluessel = workbook.getWorksheet('Schlüssel');
  if (schluessel) {
    for (let r = 1; r <= schluessel.rowCount; r++) {
      const row = schluessel.getRow(r);
      const plr = buildPlrCode(row);
      const name = String(cellValue(row, 5) ?? '').trim();
      if (name && PLR_CODES.includes(plr)) nameMap.set(plr, name);
    }
  }

  const firstRow = findFirstDataRow(t2);
  if (firstRow < 0) {
    fail('AfS: could not find the first data row in T2');
  }
  console.log(`  T2 data starts at row ${firstRow}`);

  // Build T1 migration lookup (plr_code → { mh, foreign })
  const migrationMap = new Map<string, { mh: number; foreign: number }>();
  if (t1) {
    const t1Start = findFirstDataRow(t1);
    if (t1Start > 0) {
      for (let r = t1Start; r <= t1.rowCount; r++) {
        const row = t1.getRow(r);
        const plr = buildPlrCode(row);
        if (!PLR_CODES.includes(plr)) continue;
        migrationMap.set(plr, {
          mh: toNumber(cellValue(row, T1_COLS.mh_count)),
          foreign: toNumber(cellValue(row, T1_COLS.foreign)),
        });
      }
    }
  }

  // Extract T2 rows for our PLR codes
  const rows: DemographicsRow[] = [];
  for (let r = firstRow; r <= t2.rowCount; r++) {
    const row = t2.getRow(r);
    const plr = buildPlrCode(row);
    if (!PLR_CODES.includes(plr)) continue;

    const total = toNumber(cellValue(row, T2_COLS.total));
    const female = toNumber(cellValue(row, T2_COLS.female));
    const foreign_t2 = toNumber(cellValue(row, T2_COLS.foreign));

    // Age groups — note: AfS T2 uses 6-15 and 15-18, but our schema uses u18 (under 18)
    // We combine: u18 = (6-15) + (15-18) to get 6-17 equivalent
    const u6 = toNumber(cellValue(row, T2_COLS.u6));
    const age6_15 = toNumber(cellValue(row, T2_COLS.u15));
    const age15_18 = toNumber(cellValue(row, T2_COLS.u18));

    // Migration data from T1
    const mig = migrationMap.get(plr);

    rows.push({
      plr_code: plr,
      plr_name: nameMap.get(plr) ?? plr,
      total,
      male: total - female,
      female,
      u6,
      u18: age6_15 + age15_18, // 6–17
      u27: toNumber(cellValue(row, T2_COLS.u27)),
      u45: toNumber(cellValue(row, T2_COLS.u45)),
      u55: toNumber(cellValue(row, T2_COLS.u55)),
      u65: toNumber(cellValue(row, T2_COLS.u65)),
      a65: toNumber(cellValue(row, T2_COLS.a65)),
      foreign_nationals: mig?.foreign ?? foreign_t2,
      migration_background: mig?.mh ?? 0,
      single_person: 0, // Not available in this publication
    });
  }

  console.log(`  Matched ${rows.length} of ${PLR_CODES.length} PLR areas`);
  for (const row of rows) {
    console.log(`    ${row.plr_code} — ${row.plr_name}: ${row.total} residents`);
  }

  // Refuse to write anything that does not add up (pure, tested: src/lib/kiez/syncChecks.ts):
  // file date vs period, all areas found, totals > 0, age groups = total, origin plausible.
  // The title cell may be rich text — flatten it, or the date check would be skipped.
  const rawTitle: any = t2.getRow(1).getCell(1).value;
  const title = rawTitle?.richText ? rawTitle.richText.map((p: any) => p.text).join('') : String(rawTitle ?? '');
  if (!/am \d{1,2}\. ?(Juni|Dezember) \d{4}/i.test(title)) fail(`AfS: cannot read the reference date from the T2 title ("${title.slice(0, 80)}")`);
  const problems = afsImportProblems({
    period,
    title,
    expectedAreas: PLR_CODES.length,
    rows: rows.map((r) => ({
      plr_code: r.plr_code,
      total: r.total,
      ageSum: r.u6 + r.u18 + r.u27 + r.u45 + r.u55 + r.u65 + r.a65,
      foreign: r.foreign_nationals,
      mh: r.migration_background,
    })),
  });
  if (problems.length) fail(`AfS: refusing to import —\n    · ${problems.join('\n    · ')}`);
  console.log(`  ✓ Checks passed (file date matches ${period}, ${rows.length} areas, sums add up)`);

  if (isDryRun) {
    console.log('  [DRY RUN] No database writes');
    return;
  }

  // Compute period date
  const periodDate = period.includes('h1') ? `${period.slice(0, 4)}-06-30` : `${period.slice(0, 4)}-12-31`;

  const collection = db.collection('schillerkiez_demographics');
  await collection.createIndex({ plr_code: 1, period: 1 }, { unique: true });

  let upserted = 0;
  for (const row of rows) {
    const doc = {
      plr_code: row.plr_code,
      plr_name: row.plr_name,
      period,
      date: periodDate,
      population: { total: row.total, male: row.male, female: row.female },
      age_groups: {
        u6: row.u6, u18: row.u18, u27: row.u27, u45: row.u45,
        u55: row.u55, u65: row.u65, a65: row.a65,
      },
      migration: {
        foreign_nationals: row.foreign_nationals,
        migration_background: row.migration_background,
      },
      households: { single_person: row.single_person },
    };
    await collection.updateOne(
      { plr_code: row.plr_code, period },
      { $set: doc },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ✓ Upserted ${upserted} documents into schillerkiez_demographics`);
}

// ─── MSS Social Index Sync ──────────────────────────────────────────

// MSS uses two XLSX files:
// 1. Indicators file (MSS_XLSX_URL): rates at PLR level
//    2023 layout: [1] PLR code, [2] name, [3] pop, [4] S1 unemployment, [5] S2 child poverty, [6] S3 youth unemp, [7] S4 transfer benefits
//    Pre-2023 layout: [1] PLR code, [2] name, [3] pop, [4] S1 unemployment, [5] S2 long-term unemp, [6] S3 transfer benefits, [7] S4 child poverty
// 2. SDI file (MSS_SDI_URL): Status-Index and Dynamik-Index classes
//
// Pre-2021 LOR codes for Schillerkiez (2 PLRs, split into 4 in 2021 LOR reform):
//   08010117 = Schillerpromenade (→ 08100102 Nord + 08100103 Süd)
//   08010118 = Silbersteinstraße (→ 08100104 Wartheplatz + 08100105 Silbersteinstraße)

const MSS_SDI_URL = process.env.MSS_SDI_URL;

// Old LOR codes used in MSS reports before the 2021 LOR reform
const OLD_PLR_CODES = ['08010117', '08010118'];

/** Find the sheet containing 8-digit PLR code data (not always the first sheet) */
function findDataSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  for (const ws of workbook.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
      const v = String(cellValue(ws.getRow(r), 1) ?? '').trim();
      if (/^\d{8}$/.test(v)) return ws;
    }
  }
  return null;
}

async function syncMSS(db: any) {
  const url = process.env.MSS_XLSX_URL;
  const period = process.env.MSS_PERIOD;
  if (!url) {
    console.log('\n⚠ MSS sync skipped: MSS_XLSX_URL not set');
    return;
  }
  if (!period) {
    console.log('\n⚠ MSS sync skipped: MSS_PERIOD not set');
    return;
  }

  const periodNum = parseInt(period);
  const isOldLOR = periodNum < 2021;
  const matchCodes = isOldLOR ? OLD_PLR_CODES : PLR_CODES;

  // MSS S-column semantics — verified against the 2023 files' Erläuterungen
  // sheets (PLR + Bezirke level, 2026-07-14): S1=Arbeitslosigkeit(4),
  // S2(5)=pre-2023 Langzeitarbeitslose / 2023+ Kinder in alleinerziehenden
  // Haushalten, S3=Transferbezug(6), S4=Kinderarmut(7) — SAME column order in
  // all report years. The former "2023+ layout" branch (CP=5, TR=7) was a
  // misreading and stored single-parent share as Kinderarmut and Kinderarmut
  // as Transfer for period 2023.
  const COL_UNEMPLOYMENT = 4;
  const COL_CHILD_POVERTY = 7;
  const COL_TRANSFER = 6;
  const COL_S2 = 5; // stored as single_parent_children_rate for 2023+ only

  console.log('\n═══ MSS Social Index Sync ═══');
  if (isOldLOR) console.log(`  Using pre-2021 LOR codes: ${OLD_PLR_CODES.join(', ')}`);
  console.log(`  Column layout: unemployment=col${COL_UNEMPLOYMENT}, child_poverty=col${COL_CHILD_POVERTY}, transfer=col${COL_TRANSFER}`);

  // Download indicators file
  const workbook = await downloadXlsx(url);
  const ws = findDataSheet(workbook);
  if (!ws) {
    fail(`MSS: could not find the data sheet with PLR codes (sheets: ${workbook.worksheets.map(s => s.name).join(', ')})`);
  }
  console.log(`  Indicators sheet: "${ws.name}" (${ws.rowCount} rows)`);

  // Find first data row — PLR codes are 8-digit strings in column 1
  let dataStart = -1;
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const v = String(cellValue(ws.getRow(r), 1) ?? '').trim();
    if (/^\d{8}$/.test(v)) { dataStart = r; break; }
  }
  if (dataStart < 0) {
    fail('MSS: could not find the first data row in the indicators file');
  }
  console.log(`  Data starts at row ${dataStart}`);

  // Download SDI file for Status/Dynamik index
  // Dynamik is a CLASS in the SDI file, not a number: col 6 holds the sign
  // ('+', '+/-', '-'), col 7 the word (positiv/stabil/negativ). `toNumber`
  // on the sign silently yielded 0 for every PLR (found 2026-09-09).
  const sdiMap = new Map<string, { status: number; dynamik: number; dynamikClass?: DynamikClass }>();
  if (MSS_SDI_URL) {
    try {
      const sdiWb = await downloadXlsx(MSS_SDI_URL);
      const sdiWs = findDataSheet(sdiWb) ?? sdiWb.worksheets[0];
      console.log(`  SDI sheet: "${sdiWs.name}" (${sdiWs.rowCount} rows)`);
      for (let r = 1; r <= sdiWs.rowCount; r++) {
        const row = sdiWs.getRow(r);
        const plr = String(cellValue(row, 1) ?? '').trim();
        if (!matchCodes.includes(plr)) continue;
        const dynamikClass = parseDynamikClass(cellValue(row, 6));
        sdiMap.set(plr, {
          status: toNumber(cellValue(row, 4)),
          dynamik: dynamikClass === 'positiv' ? 1 : dynamikClass === 'negativ' ? -1 : 0,
          dynamikClass,
        });
      }
    } catch (e) {
      console.log(`  ⚠ Could not fetch SDI file: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log('  ⚠ MSS_SDI_URL not set — skipping Status/Dynamik index');
  }

  // Extract indicator rows for our PLR codes
  interface SocialRow {
    plr_code: string;
    plr_name: string;
    unemployment_rate: number;
    child_poverty_rate: number;
    transfer_benefit_rate: number;
    status_index: number;
    /** +1 / 0 / -1 derived from the Dynamik class sign (was always 0 before 2026-09-09). */
    dynamik_index: number;
    /** MSS Dynamik-Index class; absent when the SDI file had no row for the PLR. */
    dynamik_class?: DynamikClass;
    single_parent_children_rate?: number;
  }

  const rows: SocialRow[] = [];
  for (let r = dataStart; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const plr = String(cellValue(row, 1) ?? '').trim();
    if (!matchCodes.includes(plr)) continue;

    // For pre-2021 data, store under old PLR code (aggregated differently)
    // but keep the original code so we can identify it
    const sdi = sdiMap.get(plr);
    const socialRow: SocialRow = {
      plr_code: plr,
      plr_name: String(cellValue(row, 2) ?? plr),
      unemployment_rate: Math.round(toNumber(cellValue(row, COL_UNEMPLOYMENT)) * 100) / 100,
      child_poverty_rate: Math.round(toNumber(cellValue(row, COL_CHILD_POVERTY)) * 100) / 100,
      transfer_benefit_rate: Math.round(toNumber(cellValue(row, COL_TRANSFER)) * 100) / 100,
      status_index: sdi?.status ?? 0,
      dynamik_index: sdi?.dynamik ?? 0,
    };
    if (sdi?.dynamikClass) socialRow.dynamik_class = sdi.dynamikClass;
    if (periodNum >= 2023) {
      socialRow.single_parent_children_rate = Math.round(toNumber(cellValue(row, COL_S2)) * 100) / 100;
    }
    rows.push(socialRow);
  }

  console.log(`  Matched ${rows.length} of ${matchCodes.length} PLR areas`);
  if (rows.length !== matchCodes.length) fail(`MSS: matched ${rows.length} of ${matchCodes.length} planning areas — refusing to import a partial social index`);
  for (const row of rows) {
    console.log(`    ${row.plr_code} — ${row.plr_name}: unemployment ${row.unemployment_rate}%, child poverty ${row.child_poverty_rate}%, transfers ${row.transfer_benefit_rate}%`);
  }

  if (isDryRun) {
    console.log('  [DRY RUN] No database writes');
    return;
  }

  const collection = db.collection('schillerkiez_social');
  await collection.createIndex({ plr_code: 1, period: 1 }, { unique: true });

  let upserted = 0;
  for (const row of rows) {
    await collection.updateOne(
      { plr_code: row.plr_code, period },
      { $set: { ...row, period, date: `${period}-12-31` }, $unset: { youth_unemployment_rate: '' } },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ✓ Upserted ${upserted} documents into schillerkiez_social`);
}

// ─── MSS Reference Sync (Berlin + Neukölln — Kiez-Daten §02 Berlin-Vergleich) ──
// Reads the MSS BEZIRKE-level share table (a separate XLSX from the PLR file,
// e.g. 23indexind_anteile_bezirke_mss2023_kor.xlsx). Verified layout: data
// rows have [1] 2-digit Bezirk code, [2] name, [3] EW (residents),
// [4..7] S1..S4 shares — same period-aware S-column semantics as syncMSS.
// Neukölln = row "08". The file has NO Berlin-total row: Berlin is derived as
// the EW-weighted mean of the 12 Bezirk rows (approximation — weights are
// total residents, not each indicator's denominator; recorded in `derivation`).

async function syncReference(db: any) {
  const url = process.env.MSS_BEZIRKE_XLSX_URL;
  const period = process.env.MSS_PERIOD;
  if (!url || !period) {
    console.log('\n⚠ Reference sync skipped: MSS_BEZIRKE_XLSX_URL or MSS_PERIOD not set');
    return;
  }

  const COL_UNEMPLOYMENT = 4;
  const COL_CHILD_POVERTY = 7; // S4 Kinderarmut — same order in all report years
  const COL_TRANSFER = 6;      // S3 Transferbezug

  console.log('\n═══ MSS Reference Sync (Bezirke) ═══');
  const workbook = await downloadXlsx(url);

  // Data sheet = first sheet containing a row with a 2-digit code in col 1 and a name in col 2
  let ws: ExcelJS.Worksheet | null = null;
  let dataStart = -1;
  outer: for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 30); r++) {
      const code = String(cellValue(sheet.getRow(r), 1) ?? '').trim();
      const name = String(cellValue(sheet.getRow(r), 2) ?? '').trim();
      if (/^\d{2}$/.test(code) && name) {
        ws = sheet;
        dataStart = r;
        break outer;
      }
    }
  }
  if (!ws || dataStart < 0) {
    fail('Reference: could not find the Bezirk data rows');
  }
  console.log(`  Sheet "${ws.name}", data starts at row ${dataStart}`);

  interface BezirkRow { code: string; name: string; ew: number; alq: number; kap: number; tr: number }
  const rows: BezirkRow[] = [];
  for (let r = dataStart; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = String(cellValue(row, 1) ?? '').trim();
    if (!/^\d{2}$/.test(code)) continue;
    rows.push({
      code,
      name: String(cellValue(row, 2) ?? code).trim(),
      ew: toNumber(cellValue(row, 3)),
      alq: toNumber(cellValue(row, COL_UNEMPLOYMENT)),
      kap: toNumber(cellValue(row, COL_CHILD_POVERTY)),
      tr: toNumber(cellValue(row, COL_TRANSFER)),
    });
  }
  console.log(`  Parsed ${rows.length} Bezirk rows`);
  if (rows.length !== 12) console.log('  ⚠ Expected 12 Bezirke — check the file layout');

  const nk = rows.find((r) => r.code === '08');
  if (!nk) {
    fail('Reference: Neukölln (code 08) not found');
  }

  const totalEw = rows.reduce((s, r) => s + r.ew, 0);
  if (totalEw <= 0) {
    fail('Reference: resident counts are zero');
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const weighted = (pick: (r: BezirkRow) => number) =>
    round2(rows.reduce((s, r) => s + pick(r) * r.ew, 0) / totalEw);

  const docs = [
    {
      scope: 'neukoelln' as const,
      period,
      date: `${period}-12-31`,
      unemployment_rate: round2(nk.alq),
      child_poverty_rate: round2(nk.kap),
      transfer_benefit_rate: round2(nk.tr),
      derivation: 'bezirk_row',
    },
    {
      scope: 'berlin' as const,
      period,
      date: `${period}-12-31`,
      unemployment_rate: weighted((r) => r.alq),
      child_poverty_rate: weighted((r) => r.kap),
      transfer_benefit_rate: weighted((r) => r.tr),
      derivation: 'ew_weighted_mean_of_bezirke',
    },
  ];
  for (const doc of docs) {
    console.log(
      `    ${doc.scope}: unemployment ${doc.unemployment_rate}% · child poverty ${doc.child_poverty_rate}% · transfer ${doc.transfer_benefit_rate}%`
    );
  }

  if (isDryRun) {
    console.log('  [DRY RUN] No database writes');
    return;
  }

  const collection = db.collection('schillerkiez_reference');
  await collection.createIndex({ scope: 1, period: 1 }, { unique: true });
  for (const doc of docs) {
    await collection.updateOne({ scope: doc.scope, period }, { $set: doc }, { upsert: true });
  }
  console.log('  ✓ Upserted 2 documents into schillerkiez_reference');
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`Schillerkiez Stats Sync${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log('PLR codes:', PLR_CODES.join(', '));

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    if (!isDryRun) {
      await client.connect();
      console.log('Connected to MongoDB');
    }

    const db = isDryRun ? null : client.db();
    await syncAfS(db);
    await syncMSS(db);
    await syncReference(db);

    console.log('\n✓ Sync complete');
  } catch (err) {
    console.error('✗ Sync failed:', err);
    process.exit(1);
  } finally {
    if (!isDryRun) await client.close();
  }
}

main();
