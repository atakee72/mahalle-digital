import type { APIRoute } from 'astro';
import { sendKiezBrief } from '../../../lib/newsletter/kiezBrief';

// Sunday-evening trigger of the weekly member mail, rung by .github/workflows/kiez-brief.yml
// (GitHub Actions — both Vercel Hobby cron slots are taken). FAIL-CLOSED like process-deletions:
// without CRON_SECRET nobody can ring it. The issue is claimed per week inside sendKiezBrief(),
// so a second ring (or the Monday fallback in fetch-daily) sends nothing.
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(request: Request): Promise<Response> {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return json({ error: 'cron_disabled' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);
  const result = await sendKiezBrief();
  return json(result);
}

export const GET: APIRoute = ({ request }) => handle(request);
