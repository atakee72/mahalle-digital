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
  personalize, verifyNoteHtml, MAIL_LOCALES, GROUP_SIZE, GROUPS_BEFORE_WARNING, berlinWeekday, groupDue, issueWeek, isQuiet, windowFor,
  subjectFor, unsubscribeHeaders, type BriefData, type MailLocale,
} from './kiezBriefRules';
import {
  claimIssue, countRecipients, findPendingIssue, findSentIssue, loadIssueData, loadSentIssue, markIssue, takeNextGroup,
  type BlogInput, type IssueDoc, type Recipient,
} from './kiezBriefStore';

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
 * name in the greeting, and — for a member who never confirmed the address — the „confirm it" note.
 * The name is ESCAPED — it goes into finished HTML by string replace, past
 * React's escaping, and names older than the 2026-09-21 rule may contain anything.
 */
export function mailsFor(issue: RenderedIssue, recipients: Recipient[], baseUrl: string, secret: string) {
  return recipients.map((r) => ({
    to: r.email,
    subject: issue.subject[r.locale],
    html: personalize(issue.html[r.locale], r.name, unsubscribeUrl(baseUrl, r.id, secret), r.locale, r.verified ? '' : verifyNoteHtml(baseUrl, r.locale)),
    replyTo: REPLY_TO,
    headers: unsubscribeHeaders(oneClickUrl(baseUrl, r.id, secret), REPLY_TO),
  }));
}

export interface SendResult {
  week: string;
  outcome: 'sent' | 'claimed-elsewhere' | 'quiet' | 'no-recipients' | 'not-configured' | 'not-due' | 'failed';
  /** Mails of THIS run (one group). */
  recipients: number;
  /** 1 = the first group, 2 = the next morning's, … */
  group?: number;
  /** true = members are still waiting; the next morning job sends their group. */
  more?: boolean;
}

/**
 * Send ONE group of an issue (see GROUP_SIZE): take and claim it, render, send, book it.
 * `issue.groups === 0` is the first group — the only one that decides „quiet" and prints the air line.
 */
async function sendGroup(db: Awaited<ReturnType<typeof connectDB>>, issue: IssueDoc, nowMs: number, baseUrl: string, secret: string): Promise<SendResult> {
  const week = issue._id;
  const first = (issue.groups ?? 0) === 0;
  // Every group gets the SAME issue: the window stored at the claim, not „now" (a later group
  // without the air line — „today's" reading would be Sunday's).
  const data = await loadIssueData(db, week, issue.windowTo.getTime(), await blogPosts(), { cloud: import.meta.env.CLOUD_NAME, air: first });
  if (first && isQuiet(data)) {
    await markIssue(db, week, { skipped: 'quiet', recipients: 0 });
    return { week, outcome: 'quiet', recipients: 0 };
  }
  if (!first && isQuiet(data)) {
    // Everything of that week was deleted since the first group: nothing left to send, close the issue.
    await markIssue(db, week, { more: false });
    return { week, outcome: 'quiet', recipients: 0 };
  }
  if (first && !isMailerConfigured()) {
    console.log(`[kiez-brief] (dev) no mail transport — ${week} is claimed, nothing is sent`);
    await markIssue(db, week, { recipients: 0 });
    if (import.meta.env.PROD) {
      Sentry.captureMessage('kiez-brief: no mail transport configured — the week was claimed but nothing was sent', { level: 'warning', extra: { week } });
      await Sentry.flush(2000);
    }
    return { week, outcome: 'not-configured', recipients: 0 };
  }

  const take = await takeNextGroup(db, issue, nowMs);
  if (!take) return { week, outcome: first ? 'claimed-elsewhere' : 'not-due', recipients: 0 };
  if (take.recipients.length === 0) return { week, outcome: 'no-recipients', recipients: 0, group: take.index + 1, more: false };

  if (first && take.more) {
    const total = await countRecipients(db).catch(() => 0);
    if (total > GROUPS_BEFORE_WARNING * GROUP_SIZE) {
      Sentry.captureMessage('kiez-brief: more members than two daily groups — the issue takes three or more days; time for the paid mail plan', {
        level: 'warning', extra: { recipients: total, groupSize: GROUP_SIZE, week },
      });
      await Sentry.flush(2000);
    }
  }

  const rendered = await renderIssueAll(data, baseUrl);
  await sendMailBatch(mailsFor(rendered, take.recipients, baseUrl, secret), `kiez-brief-${week}-g${take.index + 1}`);
  await markIssue(db, week, {
    recipients: (issue.recipients ?? 0) + take.recipients.length,
    // `sentAt` = the first group that really went out (it opens the issue's browser page).
    ...(issue.sentAt instanceof Date ? {} : { sentAt: new Date() }),
  });
  console.log(`[kiez-brief] ${week} group ${take.index + 1} sent to ${take.recipients.length} members${take.more ? ' — more waiting' : ''}`);
  return { week, outcome: 'sent', recipients: take.recipients.length, group: take.index + 1, more: take.more };
}

/**
 * Send this week's issue — one group per call, each group once. The Sunday run claims the week
 * and sends the first group. `fallback` marks the morning job (it runs every day, twice): it first
 * sends the NEXT group of an issue whose members are still waiting (one group per UTC day), and
 * only on a Berlin Monday, when Sunday's run never arrived, starts the issue itself. Never throws.
 */
export async function sendKiezBrief(opts: { fallback?: boolean; now?: number } = {}): Promise<SendResult> {
  const nowMs = opts.now ?? Date.now();
  const week = issueWeek(nowMs);
  try {
    const baseUrl = kiezBriefBaseUrl();
    const secret = unsubSecret();
    if (!baseUrl || !secret) throw new Error('kiez-brief: NEXTAUTH_URL and NEXTAUTH_SECRET are required');
    const db = await connectDB();

    if (opts.fallback === true) {
      const pending = await findPendingIssue(db, nowMs);
      if (pending) {
        // One group per UTC day (the provider's quota day): the second run of the same day waits.
        if (!groupDue(pending.lastGroupAt instanceof Date ? pending.lastGroupAt.getTime() : null, nowMs)) return { week: pending._id, outcome: 'not-due', recipients: 0 };
        return await sendGroup(db, pending, nowMs, baseUrl, secret);
      }
      // No group waiting. The fallback start is due on a Berlin Monday only (any other day its
      // issueWeek would already point at the NEXT issue).
      if (berlinWeekday(nowMs) !== 1) return { week, outcome: 'not-due', recipients: 0 };
    }

    if (!(await claimIssue(db, week, nowMs, opts.fallback === true))) return { week, outcome: 'claimed-elsewhere', recipients: 0 };
    const w = windowFor(nowMs);
    const claimed: IssueDoc = { _id: week, windowFrom: new Date(w.fromMs), windowTo: new Date(w.toMs), claimedAt: new Date(nowMs), fallback: opts.fallback === true, groups: 0, cursor: null, more: false };
    return await sendGroup(db, claimed, nowMs, baseUrl, secret);
  } catch (err) {
    await capture(err);
    return { week, outcome: 'failed', recipients: 0 };
  }
}
