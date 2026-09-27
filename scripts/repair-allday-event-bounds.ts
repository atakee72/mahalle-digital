// scripts/repair-allday-event-bounds.ts
// Run: pnpm tsx scripts/repair-allday-event-bounds.ts                  (DRY RUN, dev db)
//      pnpm tsx scripts/repair-allday-event-bounds.ts --apply          (writes, dev db)
//      pnpm tsx scripts/repair-allday-event-bounds.ts --apply --prod   (prod — the USER runs this)
//
// Until 2026-09-27 the composer stored an all-day event as UTC midnight → UTC
// 23:59:59, which Berlin reads as two calendar days. Rewrites such rows to the
// Berlin day bounds of the civil days their UTC dates name (allDayRepair.ts).
// A row whose end day already grew through re-saves keeps that end day — the
// author fixes it once in the form. Rows already in Berlin shape are skipped.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { repairedAllDayBounds } from '../src/lib/calendar/allDayRepair';
import { berlinDayOf } from '../src/lib/calendar/berlinDay';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

async function main() {
  const raw = process.env.MONGODB_URI;
  if (!raw) { console.error('MONGODB_URI missing'); process.exit(1); }
  const u = new URL(raw);
  if (PROD) u.pathname = '/mahalle';
  const dbName = u.pathname.slice(1);
  if (!dbName.includes('dev') && !PROD) {
    console.error(`refusing: db name "${dbName}" does not look like a dev db (pass --prod to override)`);
    process.exit(1);
  }
  const client = new MongoClient(u.toString());
  await client.connect();
  try {
    const events = client.db().collection('events');
    const rows = await events.find({ allDay: true }, { projection: { title: 1, startDate: 1, endDate: 1 } }).toArray();
    let fixed = 0, skipped = 0;
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · db ${dbName} · ${rows.length} all-day events`);
    for (const r of rows) {
      const start = new Date(r.startDate), end = new Date(r.endDate);
      const next = repairedAllDayBounds(start, end);
      if (!next) { skipped++; continue; }
      console.log(`  ${String(r._id)}  ${String(r.title).slice(0, 48).padEnd(48)}  ${start.toISOString()} → ${end.toISOString()}  ⇒  ${berlinDayOf(next.start)} … ${berlinDayOf(next.end)} (Berlin)`);
      // Filter on the old bounds too: an author edit landing between the read and
      // this write must win (matchedCount 0 → reported, not overwritten).
      if (APPLY) {
        const res = await events.updateOne({ _id: r._id, startDate: start, endDate: end }, { $set: { startDate: next.start, endDate: next.end, updatedAt: new Date() } });
        if (res.matchedCount === 0) { console.log('    ↳ changed meanwhile, left alone'); continue; }
      }
      fixed++;
    }
    console.log(`${APPLY ? 'rewrote' : 'would rewrite'} ${fixed}, already fine ${skipped}`);
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
