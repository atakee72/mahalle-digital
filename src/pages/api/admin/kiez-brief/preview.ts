import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { isMailerConfigured, sendMail } from '../../../../lib/email/mailer';
import { buildIssue, kiezBriefBaseUrl, mailsFor, renderIssue } from '../../../../lib/newsletter/kiezBrief';
import { unsubSecret } from '../../../../lib/newsletter/unsubToken';
import { isQuiet, subjectFor } from '../../../../lib/newsletter/kiezBriefRules';

// The owner's look at THIS week's issue: GET renders the HTML in the browser (no claim, no send);
// POST sends one copy to the admin's own address — the way to see it in a real mail client before
// the first Sunday and after any template change. The send is a POST on purpose: a GET that sends
// mail could be triggered by any link the admin is lured to click.
async function issueForAdmin(request: Request, userId: string) {
  const data = await buildIssue();
  const baseUrl = kiezBriefBaseUrl() || new URL(request.url).origin;
  const [mine] = mailsFor(await renderIssue(data, baseUrl), subjectFor(data), [{ id: userId, email: 'preview', name: null }], baseUrl, unsubSecret());
  return { data, mine }; // mine.html carries the admin's own unsubscribe link
}

export const GET: APIRoute = async ({ request }) => {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return gate.response;
  const { data, mine } = await issueForAdmin(request, gate.userId);
  return new Response(mine.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kiez-Brief-Quiet': String(isQuiet(data)) },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return gate.response;
  const db = await connectDB();
  const admin = await db.collection('users').findOne({ _id: new ObjectId(gate.userId) }, { projection: { email: 1 } });
  if (!admin || typeof admin.email !== 'string') return new Response(JSON.stringify({ error: 'no_email' }), { status: 400 });
  if (!isMailerConfigured()) return new Response(JSON.stringify({ error: 'mailer_not_configured' }), { status: 503 });
  const { data, mine } = await issueForAdmin(request, gate.userId);
  await sendMail({ ...mine, to: admin.email, subject: `[Vorschau] ${subjectFor(data)}` });
  return new Response(JSON.stringify({ sent: true, to: admin.email, quiet: isQuiet(data) }), { headers: { 'Content-Type': 'application/json' } });
};
