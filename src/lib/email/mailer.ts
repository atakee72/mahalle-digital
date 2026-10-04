// src/lib/email/mailer.ts — SERVER-ONLY (imports nodemailer + @sentry/astro;
// never import from client components/islands).
//
// Single transport chooser for ALL outgoing app email:
//   1. SMTP (mailbox.org relay) when SMTP_HOST + SMTP_USER + SMTP_PASS are set
//   2. Resend when RESEND_API_KEY is set (legacy path, kept for the future
//      own-domain switch — flipping back is a pure env change)
//   3. neither → isMailerConfigured() is false; callers keep their per-flow
//      dev-log fallbacks (they print the actionable LINK, not raw HTML).
//
// sendMail() THROWS on any failure — including Resend's { error } return,
// which its SDK does NOT throw on (this silently ate every failed send
// until July 2026). Failures are captured to Sentry WITH flush before the
// rethrow: several callers are deliberately best-effort and swallow the
// throw (register, forgot-password), and Vercel freezes the instance the
// moment the response leaves (same lesson as src/middleware.ts) — without
// the flush those captures never leave the building.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import * as Sentry from '@sentry/astro';
import { punycodeEmailDomain } from './idn';

const SMTP_HOST = import.meta.env.SMTP_HOST || '';
const SMTP_PORT = Number(import.meta.env.SMTP_PORT || '587');
const SMTP_USER = import.meta.env.SMTP_USER || '';
const SMTP_PASS = import.meta.env.SMTP_PASS || '';
const RESEND_API_KEY = import.meta.env.RESEND_API_KEY || '';
// For SMTP this MUST be overridden via env to the alias registered at the
// SMTP provider (mailbox.org refuses unregistered From addresses). The
// fallback is only a safety net for a missing env var — every real env
// (prod, local dev) sets SENDING_FROM_EMAIL explicitly.
const SENDING_FROM = import.meta.env.SENDING_FROM_EMAIL || 'Mahalle <noreply@mahalle.digital>';

const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

export function isMailerConfigured(): boolean {
  return smtpConfigured || Boolean(RESEND_API_KEY);
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Extra headers (e.g. List-Unsubscribe for the Kiez-Brief). */
  headers?: Record<string, string>;
}

// The Resend SDK rides a bare fetch with no timeout — a hung provider would
// hold the awaited send (and the caller's request, e.g. verify-email) open
// until Vercel kills the function. Same lesson as web-push's timeout: 10000.
// The raced-out fetch keeps running in the background; we only stop waiting.
const RESEND_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Lazy module-level singleton — reused on warm serverless instances.
// Pooling stays off (nodemailer default): one connection per send, no
// half-dead pooled sockets surviving a freeze/thaw cycle.
let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 587 = STARTTLS
      requireTLS: true, // never fall back to plaintext
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Serverless: fail fast instead of holding the function open
      // (nodemailer defaults wait up to ~2 min).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export async function sendMail(input: MailInput): Promise<void> {
  try {
    // IDN addresses (admitted by register's structural regex) must reach the
    // transports with an ASCII domain — Resend hard-rejects ümläüts.
    const to = punycodeEmailDomain(input.to);
    const replyTo = input.replyTo ? punycodeEmailDomain(input.replyTo) : undefined;

    if (smtpConfigured) {
      await getTransporter().sendMail({
        from: SENDING_FROM,
        to,
        subject: input.subject,
        html: input.html,
        ...(replyTo ? { replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
      });
      return;
    }
    if (RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);
      const { error } = await withTimeout(
        resend.emails.send({
          from: SENDING_FROM,
          to,
          subject: input.subject,
          html: input.html,
          ...(replyTo ? { replyTo } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
        }),
        RESEND_TIMEOUT_MS,
        'Resend send'
      );
      if (error) {
        throw new Error(`Resend send failed: ${error.name}: ${error.message}`);
      }
      return;
    }
    throw new Error(
      'sendMail called with no mail transport configured — gate calls with isMailerConfigured()'
    );
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: 'mailer', transport: smtpConfigured ? 'smtp' : RESEND_API_KEY ? 'resend' : 'none' },
    });
    await Sentry.flush(2000);
    throw err;
  }
}

/**
 * Several mails in one go (the Kiez-Brief). Resend: ONE call to its batch endpoint (up to 100
 * mails) with an Idempotency-Key, so a duplicated HTTP call inside a run cannot send twice.
 * SMTP/dev: sequential sendMail (the batch is a Resend feature, not a contract). Throws like
 * sendMail; the caller decides what a failure means.
 */
export async function sendMailBatch(inputs: MailInput[], idempotencyKey: string): Promise<void> {
  if (!inputs.length) return;
  if (inputs.length > 100) throw new Error('sendMailBatch: at most 100 mails per batch');
  if (!smtpConfigured && RESEND_API_KEY) {
    try {
      const resend = new Resend(RESEND_API_KEY);
      // 'permissive': the provider's default ('strict') rejects ALL mails of a batch when ONE
      // address is malformed — a typo of one member would cost a whole Kiez-Brief group.
      const { data, error } = await withTimeout(
        resend.batch.send(
          inputs.map((input) => ({
            from: SENDING_FROM,
            to: punycodeEmailDomain(input.to),
            subject: input.subject,
            html: input.html,
            ...(input.replyTo ? { replyTo: punycodeEmailDomain(input.replyTo) } : {}),
            ...(input.headers ? { headers: input.headers } : {}),
          })),
          { idempotencyKey, batchValidation: 'permissive' },
        ),
        RESEND_TIMEOUT_MS * 3,
        'Resend batch send'
      );
      if (error) throw new Error(`Resend batch failed: ${error.name}: ${error.message}`);
      const refused = Array.isArray(data?.errors) ? data.errors.length : 0;
      if (refused > 0) {
        // Fixed text (one Sentry issue), the count in `extra`, never an address.
        Sentry.captureMessage('mailer-batch: the provider refused some mails of a batch (malformed addresses?) — the rest was sent', {
          level: 'warning', extra: { refused, of: inputs.length },
        });
        try { await Sentry.flush(2000); } catch { /* best-effort */ }
      }
      return;
    } catch (err) {
      Sentry.captureException(err, { tags: { feature: 'mailer-batch' } });
      try { await Sentry.flush(2000); } catch { /* best-effort */ }
      throw err;
    }
  }
  for (const input of inputs) await sendMail(input);
}
