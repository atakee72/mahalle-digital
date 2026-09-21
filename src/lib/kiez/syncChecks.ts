// Pure checks for scripts/sync-stats.ts — the import must FAIL when the file is
// not what we think it is. Until 2026-09-21 a missing sheet printed a red cross,
// returned, and the run still ended with "✓ Sync complete" and exit code 0: a
// scheduled run against a changed or wrong file would have stayed green while
// importing nothing (or zeros). Dependency-pure, tested.

const MONTHS: Record<string, string> = { juni: '06-30', dezember: '12-31' };

/** "2026h1" → "2026-06-30", "2025h2" → "2025-12-31"; null for anything else. */
export function expectedRefDate(period: string): string | null {
  const m = period.match(/^(\d{4})h([12])$/);
  return m ? `${m[1]}-${m[2] === '1' ? '06-30' : '12-31'}` : null;
}

/** Reference date named in an AfS table title ("… in Berlin am 30. Juni 2026 nach …"). */
export function refDateFromTitle(title: string): string | null {
  const m = title.replace(/\s+/g, ' ').match(/am (\d{1,2})\. ?(Juni|Dezember) (\d{4})/i);
  if (!m) return null;
  const tail = MONTHS[m[2].toLowerCase()];
  return tail && Number(m[1]) === Number(tail.slice(3)) ? `${m[3]}-${tail}` : null;
}

/** Why a parsed AfS import must not be written — empty list = fine. */
export function afsImportProblems(input: {
  period: string;
  title: string;
  expectedAreas: number;
  rows: { plr_code: string; total: number; ageSum: number; foreign: number; mh: number }[];
}): string[] {
  const problems: string[] = [];
  const want = expectedRefDate(input.period);
  const got = refDateFromTitle(input.title);
  if (!want) problems.push(`period "${input.period}" is not of the form 2026h1`);
  else if (got && got !== want) problems.push(`the file is dated ${got} but the period ${input.period} means ${want}`);
  if (input.rows.length !== input.expectedAreas)
    problems.push(`matched ${input.rows.length} of ${input.expectedAreas} planning areas`);
  for (const r of input.rows) {
    if (!(r.total > 0)) problems.push(`${r.plr_code}: total is ${r.total}`);
    else if (r.ageSum !== r.total) problems.push(`${r.plr_code}: age groups add up to ${r.ageSum}, total is ${r.total}`);
    // Origin: "with migration background" INCLUDES foreign nationals, so
    // 0 < foreign ≤ mh ≤ total. A zero means sheet T1 was missing or moved —
    // the page would show "0 % with migration background" as if it were a finding.
    if (r.total > 0 && !(r.foreign > 0 && r.mh >= r.foreign && r.mh <= r.total))
      problems.push(`${r.plr_code}: origin figures implausible (foreign ${r.foreign}, with migration background ${r.mh}, total ${r.total})`);
  }
  return problems;
}
