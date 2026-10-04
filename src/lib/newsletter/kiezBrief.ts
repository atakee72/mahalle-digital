/**
 * Kiez-Brief — the sending side. SERVER-ONLY, NEVER-THROW (Sentry capture + flush): a failed
 * issue must not fail the cron request it rides in. Rules: kiezBriefRules.ts · db: kiezBriefStore.ts.
 */
import React from 'react';
import { render } from '@react-email/render';
import * as Sentry from '@sentry/astro';
import { getCollection } from 'astro:content';
import { connectDB } from '../mongodb';
import { isMailerConfigured, sendMailBatch } from '../email/mailer';
import KiezBriefEmail from '../../emails/KiezBriefEmail';
import { makeUnsubToken, unsubSecret } from './unsubToken';
import {
  personalize, MAIL_LOCALES, MAX_RECIPIENTS, berlinWeekday, issueWeek, isQuiet,
  subjectFor, unsubscribeHeaders, type BriefData, type MailLocale,
} from './kiezBriefRules';
import { claimIssue, findSentIssue, loadIssueData, loadRecipients, loadSentIssue, markIssue, type BlogInput, type Recipient } from './kiezBriefStore';

const REPLY_TO = 'admin@mahalle.digital';

async function capture(err: unknown): Promise<void> {
  console.error('[kiez-brief] failed:', err);
  try {
    Sentry.captureException(err);
    await Sentry.flush(2000);
  } catch {
    /* best-effort */
  }
}

/** The trusted absolute origin for the mail's links — never a request host. */
export function kiezBriefBaseUrl(): string {
  return (import.meta.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
}

async function blogPosts(): Promise<BlogInput[]> {
  const posts = await getCollection('blog');
  return posts.map((p) => ({ slug: p.id, title: p.data.title, description: p.data.description, pubDate: p.data.pubDate, draft: p.data.draft, cover: p.data.cover?.src ?? null }));
}

/** This week's data (no claim, no send) — the admin preview and the sender share it. */
export async function buildIssue(nowMs = Date.now()): Promise<BriefData> {
  const db = await connectDB();
  return loadIssueData(db, issueWeek(nowMs), nowMs, await blogPosts(), { cloud: import.meta.env.CLOUD_NAME });
}

/** A sent issue for the browser view (rebuilt from today's data, see loadSentIssue); null = no such sent issue. */
export async function buildSentIssue(week: unknown): Promise<BriefData | null> {
  const db = await connectDB();
  const doc = await findSentIssue(db, week);
  if (!doc) return null;
  return loadSentIssue(db, doc, await blogPosts(), { cloud: import.meta.env.CLOUD_NAME });
}

/** The mail's HTML in one language, with the unsubscribe and name placeholders still inside. `web` = the browser view. */
export async function renderIssue(data: BriefData, baseUrl: string, locale: MailLocale = 'de', web = false): Promise<string> {
  return render(React.createElement(KiezBriefEmail, { data, baseUrl, locale, web }));
}

export interface RenderedIssue { html: Record<MailLocale, string>; subject: Record<MailLocale, string> }

/** One render per language — every recipient gets the one their stored toggle names. */
export async function renderIssueAll(data: BriefData, baseUrl: string): Promise<RenderedIssue> {
  const html = {} as Record<MailLocale, string>;
  const subject = {} as Record<MailLocale, string>;
  for (const l of MAIL_LOCALES) {
    html[l] = await renderIssue(data, baseUrl, l);
    subject[l] = subjectFor(data, l);
  }
  return { html, subject };
}

export function unsubscribeUrl(baseUrl: string, userId: string, secret: string): string {
  return `${baseUrl}/newsletter/abmelden?t=${makeUnsubToken(userId, secret)}`;
}

export function oneClickUrl(baseUrl: string, userId: string, secret: string): string {
  return `${baseUrl}/api/newsletter/unsubscribe?t=${makeUnsubToken(userId, secret)}`;
}

/**
 * One rendered issue → one MailInput per recipient: their language, their unsubscribe link, their
 * name in the greeting. The name is ESCAPED — it goes into finished HTML by string replace, past
 * React's escaping, and names older than the 2026-09-21 rule may contain anything.
 */
export function mailsFor(issue: RenderedIssue, recipients: Recipient[], baseUrl: string, secret: string) {
  return recipients.map((r) => ({
    to: r.email,
    subject: issue.subject[r.locale],
    html: personalize(issue.html[r.locale], r.name, unsubscribeUrl(baseUrl, r.id, secret), r.locale),
    replyTo: REPLY_TO,
    headers: unsubscribeHeaders(oneClickUrl(baseUrl, r.id, secret), REPLY_TO),
  }));
}

export interface SendResult {
  week: string;
  outcome: 'sent' | 'claimed-elsewhere' | 'quiet' | 'quota' | 'not-configured' | 'not-due' | 'failed';
  recipients: number;
}

/**
 * Send this week's issue, once. `fallback` marks the Monday run (it only sends on a Berlin Monday, and only when
 * Sunday's never arrived — the claim decides). Never throws.
 */
export async function sendKiezBrief(opts: { fallback?: boolean; now?: number } = {}): Promise<SendResult> {
  const nowMs = opts.now ?? Date.now();
  const week = issueWeek(nowMs);
  // The fallback rides a daily job: it is due on a Berlin Monday only (any other day its
  // issueWeek would already point at the NEXT issue).
  if (opts.fallback === true && berlinWeekday(nowMs) !== 1) return { week, outcome: 'not-due', recipients: 0 };
  try {
    const baseUrl = kiezBriefBaseUrl();
    const secret = unsubSecret();
    if (!baseUrl || !secret) throw new Error('kiez-brief: NEXTAUTH_URL and NEXTAUTH_SECRET are required');
    const db = await connectDB();
    if (!(await claimIssue(db, week, nowMs, opts.fallback === true))) return { week, outcome: 'claimed-elsewhere', recipients: 0 };

    const data = await loadIssueData(db, week, nowMs, await blogPosts(), { cloud: import.meta.env.CLOUD_NAME });
    if (isQuiet(data)) {
      await markIssue(db, week, { skipped: 'quiet', recipients: 0 });
      return { week, outcome: 'quiet', recipients: 0 };
    }
    const recipients = await loadRecipients(db);
    if (recipients.length > MAX_RECIPIENTS) {
      await markIssue(db, week, { skipped: 'quota', recipients: 0 });
      Sentry.captureMessage('kiez-brief: more recipients than the daily mail quota allows — upgrade the Resend plan', {
        level: 'warning', extra: { recipients: recipients.length, max: MAX_RECIPIENTS, week },
      });
      await Sentry.flush(2000);
      return { week, outcome: 'quota', recipients: recipients.length };
    }
    if (!isMailerConfigured()) {
      console.log(`[kiez-brief] (dev) no mail transport — would send ${week} to ${recipients.length} members`);
      await markIssue(db, week, { recipients: 0 });
      if (import.meta.env.PROD) {
        Sentry.captureMessage('kiez-brief: no mail transport configured — the week was claimed but nothing was sent', { level: 'warning', extra: { week } });
        await Sentry.flush(2000);
      }
      return { week, outcome: 'not-configured', recipients: recipients.length };
    }
    const issue = await renderIssueAll(data, baseUrl);
    await sendMailBatch(mailsFor(issue, recipients, baseUrl, secret), `kiez-brief-${week}`);
    await markIssue(db, week, { recipients: recipients.length, sentAt: new Date() });
    console.log(`[kiez-brief] ${week} sent to ${recipients.length} members`);
    return { week, outcome: 'sent', recipients: recipients.length };
  } catch (err) {
    await capture(err);
    return { week, outcome: 'failed', recipients: 0 };
  }
}
