<script lang="ts">
  import { t } from '../../../lib/kiosk-i18n';
  import { PasswordResetSchema } from '../../../schemas/auth.schema';
  import { reportUnexpectedAuth } from '../../../lib/sentry/reportUnexpectedAuth';
  import AuthField from './primitives/AuthField.svelte';
  import AuthPrimaryBtn from './primitives/AuthPrimaryBtn.svelte';

  let email = $state('');
  let emailErr = $state<string | null>(null);
  let stage = $state<'request' | 'sent'>('request');
  let loading = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    emailErr = null;
    const parsed = PasswordResetSchema.safeParse({ email });
    if (!parsed.success) { emailErr = $t['auth.err.emailInvalid']; return; }
    loading = true;
    try {
      // Anti-enum: response is always generic 200; we advance to "sent" regardless.
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: parsed.data.email }),
      });
      reportUnexpectedAuth('forgot-password', res); // sensor (2026-10-31): the „sent" card stays, Sentry learns of a dead route
    } catch (e) { reportUnexpectedAuth('forgot-password', null, e); /* still show sent — never reveal anything */ }
    loading = false;
    stage = 'sent';
  }
</script>

<div class="auth-card">
  {#if stage === 'request'}
    <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-accent); font-weight:600;">{$t['auth.forgot.eyebrow']}</div>
    <h1 class="font-bricolage" style="font-weight:800; font-size:34px; letter-spacing:-0.035em; line-height:1.05; margin:8px 0 0; color:var(--k-ink);">
      {$t['auth.forgot.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.forgot.title.accent']}</span>{$t['auth.forgot.title.b']}
    </h1>
    <p class="font-instrument" style="font-style:italic; font-size:15px; color:var(--k-ink-soft); margin:10px 0 20px;">{$t['auth.forgot.sub']}</p>
    <form onsubmit={submit} style="display:flex; flex-direction:column; gap:16px;">
      <AuthField label={$t['auth.forgot.email']} placeholder={$t['auth.forgot.emailPh']}
        type="email" name="email" autocomplete="email" value={email} error={emailErr}
        oninput={(v) => (email = v)} />
      <AuthPrimaryBtn loading={loading}>{loading ? $t['auth.forgot.ctaLoading'] : $t['auth.forgot.cta']}</AuthPrimaryBtn>
    </form>
    <div style="text-align:center; margin-top:16px;">
      <a href="/login" class="font-dmmono no-underline kiosk-tap" style="font-size:11px; color:var(--k-ink-soft); border-bottom:1px dashed var(--k-ink-mute);">{$t['auth.forgot.back']}</a>
    </div>
  {:else}
    <div class="flex justify-center" style="margin-bottom:16px;">
      <div class="flex items-center justify-center" style="width:60px; height:60px; border-radius:50%; background:var(--k-accent); border:2px solid var(--k-ink); box-shadow:3px 3px 0 var(--k-ink); font-size:26px; transform:rotate(-4deg);">✉</div>
    </div>
    <div style="text-align:center;">
      <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-accent); font-weight:600;">{$t['auth.forgot.eyebrow']}</div>
      <h1 class="font-bricolage" style="font-weight:800; font-size:30px; letter-spacing:-0.03em; line-height:1.05; margin:8px 0 10px; color:var(--k-ink);">
        {$t['auth.forgot.sentTitle.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.forgot.sentTitle.accent']}</span>{$t['auth.forgot.sentTitle.b']}
      </h1>
      <p class="font-bricolage" style="font-size:13.5px; color:var(--k-ink-soft); margin:0 0 4px;">{$t['auth.forgot.sentSub']}</p>
      <div class="font-dmmono" style="font-size:13px; font-weight:600; color:var(--k-ink); padding:5px 0;">{email}</div>
      <p class="font-bricolage" style="font-size:12.5px; color:var(--k-ink-soft); line-height:1.5; max-width:330px; margin:8px auto 0;">{$t['auth.forgot.sentBody']}</p>
    </div>
    <div style="text-align:center; margin-top:20px;">
      <a href="/login" class="font-dmmono no-underline kiosk-tap" style="font-size:11px; color:var(--k-ink-soft); border-bottom:1px dashed var(--k-ink-mute);">{$t['auth.forgot.back']}</a>
    </div>
  {/if}
</div>

<style>
  .auth-card {
    background: var(--k-paper-warm);
    border: 1.5px solid var(--k-ink);
    border-top: 4px solid var(--k-accent);
    border-radius: 22px;
    box-shadow: 3px 3px 0 var(--k-ink);
    padding: 30px;
  }
</style>
