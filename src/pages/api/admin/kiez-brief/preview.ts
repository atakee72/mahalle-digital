import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { requireAdminSession } from '../../../../lib/auth';
import { connectDB } from '../../../../lib/mongodb';
import { isMailerConfigured, sendMail } from '../../../../lib/email/mailer';
import { buildIssue, kiezBriefBaseUrl, mailsFor, renderIssueAll } from '../../../../lib/newsletter/kiezBrief';
import { unsubSecret } from '../../../../lib/newsletter/unsubToken';
import { isQuiet, storedMailLocale, subjectFor } from '../../../../lib/newsletter/kiezBriefRules';
import { alertKiezBrief } from '../../../../lib/adminAlerts';

// The owner's look at THIS week's issue: GET renders the HTML in the browser (no claim, no send);
// POST sends one copy to the admin's own address — the way to see it in a real mail client before
// the first Sunday and after any template change. The send is a POST on purpose: a GET that sends
// mail could be triggered by any link the admin is lured to click.
async function issueForAdmin(request: Request, userId: string) {
  const data = await buildIssue();
  const baseUrl = kiezBriefBaseUrl() || new URL(request.url).origin;
  const db = await connectDB();
  const admin = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { email: 1, name: 1, locale: 1, emailVerified: 1 } });
  // `?lang=en|de` shows the other language; default = the admin's own stored toggle.
  const wanted = new URL(request.url).searchParams.get('lang');
  const locale = storedMailLocale(wanted === 'en' || wanted === 'de' ? wanted : admin?.locale);
  const issue = await renderIssueAll(data, baseUrl);
  const [mine] = mailsFor(issue, [{ id: userId, email: typeof admin?.email === 'string' ? admin.email : 'preview', name: typeof admin?.name === 'string' ? admin.name : null, locale, verified: admin?.emailVerified === true }], baseUrl, unsubSecret());
  return { data, mine, email: typeof admin?.email === 'string' ? admin.email : null, locale };
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
  if (!isMailerConfigured()) return new Response(JSON.stringify({ error: 'mailer_not_configured' }), { status: 503 });
  const { data, mine, email, locale } = await issueForAdmin(request, gate.userId);
  if (!email) return new Response(JSON.stringify({ error: 'no_email' }), { status: 400 });
  await sendMail({ ...mine, to: email, subject: `[Vorschau] ${subjectFor(data, locale)}` });
  await alertKiezBrief({ week: data.week, outcome: 'test' });
  return new Response(JSON.stringify({ sent: true, to: email, quiet: isQuiet(data), locale }), { headers: { 'Content-Type': 'application/json' } });
};
