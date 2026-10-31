<script lang="ts">
  import { t } from '../../../lib/kiosk-i18n';
  import { reportUnexpectedAuth } from '../../../lib/sentry/reportUnexpectedAuth';
  import { ResetPasswordSchema } from '../../../schemas/auth.schema';
  import AuthField from './primitives/AuthField.svelte';
  import AuthPrimaryBtn from './primitives/AuthPrimaryBtn.svelte';
  import AuthStrength from './primitives/AuthStrength.svelte';
  import AuthBanner from './primitives/AuthBanner.svelte';

  let { token }: { token: string } = $props();

  let password = $state('');
  let password2 = $state('');
  let pwErr = $state<string | null>(null);
  let pw2Err = $state<string | null>(null);
  let formErr = $state<string | null>(null);
  let stage = $state<'reset' | 'done'>('reset');
  let loading = $state(false);

  function scorePw(pw: string): 0 | 1 | 2 | 3 | 4 {
    if (pw.length < 8) return pw.length === 0 ? 0 : 1;
    let c = 0;
    if (/[a-z]/.test(pw)) c++;
    if (/[A-Z]/.test(pw)) c++;
    if (/\d/.test(pw)) c++;
    if (/[^A-Za-z0-9]/.test(pw)) c++;
    if (c <= 1) return 1; if (c === 2) return 2; if (c === 3) return 3; return 4;
  }
  const pwScore = $derived(scorePw(password));
  const pwOk = $derived(password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password));

  async function submit(e: Event) {
    e.preventDefault();
    pwErr = null; pw2Err = null; formErr = null;
    let bad = false;
    if (!pwOk) { pwErr = $t['auth.err.pwWeak']; bad = true; }
    if (password2 !== password || !password2) { pw2Err = $t['auth.err.mismatch']; bad = true; }
    if (bad) return;

    const parsed = ResetPasswordSchema.safeParse({ token, password, confirmPassword: password2 });
    if (!parsed.success) { formErr = $t['auth.err.generic']; return; }

    loading = true;
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) { reportUnexpectedAuth('reset-password', res); formErr = $t['auth.err.resetFailed']; loading = false; return; }
      stage = 'done';
    } catch (e) {
      reportUnexpectedAuth('reset-password', null, e);
      formErr = $t['auth.err.generic'];
    }
    loading = false;
  }
</script>

<div class="auth-card">
  {#if stage === 'reset'}
    <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-accent); font-weight:600;">{$t['auth.reset.eyebrow']}</div>
    <h1 class="font-bricolage" style="font-weight:800; font-size:34px; letter-spacing:-0.035em; line-height:1.05; margin:8px 0 14px; color:var(--k-ink);">
      {$t['auth.reset.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.reset.title.accent']}</span>{$t['auth.reset.title.b']}
    </h1>
    {#if formErr}<AuthBanner kind="danger" title={formErr} />{/if}
    <form onsubmit={submit} style="display:flex; flex-direction:column; gap:16px; margin-top:6px;">
      <div>
        <AuthField label={$t['auth.reset.pw']} placeholder={$t['auth.reset.pwPh']}
          type="password" name="password" autocomplete="new-password" value={password}
          error={pwErr} showToggle oninput={(v) => (password = v)} />
        {#if password}<AuthStrength score={pwScore} />{/if}
      </div>
      <AuthField label={$t['auth.reset.pw2']} placeholder={$t['auth.reset.pwPh']}
        type="password" name="password2" autocomplete="new-password" value={password2}
        error={pw2Err} success={!!password2 && password2 === password} oninput={(v) => (password2 = v)} />
      <AuthPrimaryBtn loading={loading}>{loading ? $t['auth.reset.ctaLoading'] : $t['auth.reset.cta']}</AuthPrimaryBtn>
    </form>
  {:else}
    <div style="text-align:center;">
      <div class="flex justify-center" style="margin-bottom:16px;">
        <div class="flex items-center justify-center" style="width:64px; height:64px; border-radius:50%; background:var(--k-success); border:2px solid var(--k-ink); box-shadow:3px 3px 0 var(--k-ink); color:var(--k-paper); font-size:30px; transform:rotate(-4deg);">✓</div>
      </div>
      <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-success); font-weight:600;">{$t['auth.reset.doneEyebrow']}</div>
      <h1 class="font-bricolage" style="font-weight:800; font-size:30px; letter-spacing:-0.03em; line-height:1.05; margin:8px 0 8px; color:var(--k-ink);">
        {$t['auth.reset.doneTitle.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.reset.doneTitle.accent']}</span>{$t['auth.reset.doneTitle.b']}
      </h1>
      <p class="font-instrument" style="font-style:italic; font-size:15px; color:var(--k-ink-soft); margin:0 0 22px;">{$t['auth.reset.doneSub']}</p>
      <AuthPrimaryBtn type="button" onclick={() => (window.location.href = '/login')}>{$t['auth.reset.doneCta']}</AuthPrimaryBtn>
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
