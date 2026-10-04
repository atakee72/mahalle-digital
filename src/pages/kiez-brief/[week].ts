import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ObjectId } from 'mongodb';
import { connectDB } from '../../lib/mongodb';
import { buildSentIssue, renderIssue, unsubscribeUrl } from '../../lib/newsletter/kiezBrief';
import { unsubSecret } from '../../lib/newsletter/unsubToken';
import { personalize, storedMailLocale } from '../../lib/newsletter/kiezBriefRules';

// The browser view of one SENT Kiez-Brief issue („Im Browser ansehen" in the mail). Members only
// (middleware: /kiez-brief is a gated page). The answer is the mail's own HTML — no app chrome —
// rebuilt from today's data for the issue's stored window, in the VIEWER's language and with the
// viewer's name and unsubscribe link (a forwarded mail never shows the sender's). Every link is
// RELATIVE (base '' instead of NEXTAUTH_URL): the reader stays on the host they are on.
// An unknown, skipped or never-sent week goes to the list.
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex',
  // Member text sits in this same-origin document: no script, no frame, no form, whatever it contains.
  'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export const GET: APIRoute = async ({ params, request, redirect }) => {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId || !ObjectId.isValid(userId)) return redirect('/login?redirect=/kiez-brief');

  const data = await buildSentIssue(params.week);
  if (!data) return redirect('/kiez-brief');

  const db = await connectDB();
  const me = await db.collection('users').findOne({ _id: new ObjectId(userId) }, { projection: { name: 1, locale: 1 } });
  const locale = storedMailLocale(me?.locale);
  const html = personalize(
    await renderIssue(data, '', locale, true),
    typeof me?.name === 'string' ? me.name : null,
    unsubscribeUrl('', userId, unsubSecret()),
    locale,
  );
  return new Response(html, { headers: HEADERS });
};
