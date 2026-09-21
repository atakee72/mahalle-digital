<script lang="ts">
  import { signIn } from 'auth-astro/client';
  import { t } from '../../../lib/kiosk-i18n';
  import { cleanDisplayName, isValidDisplayName } from '../../../lib/profile/nameRules';
  import AuthField from './primitives/AuthField.svelte';
  import AuthPrimaryBtn from './primitives/AuthPrimaryBtn.svelte';
  import AuthBanner from './primitives/AuthBanner.svelte';
  import AuthStrength from './primitives/AuthStrength.svelte';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let password2 = $state('');
  let terms = $state(false);

  let nameErr = $state<string | null>(null);
  let emailErr = $state<string | null>(null);
  let pwErr = $state<string | null>(null);
  let pw2Err = $state<string | null>(null);
  let termsErr = $state(false);
  let emailTaken = $state(false);
  let status = $state<'idle' | 'loading' | 'success'>('idle');

  // Local password strength: length + character classes → 0..4.
  function scorePw(pw: string): 0 | 1 | 2 | 3 | 4 {
    if (pw.length < 8) return pw.length === 0 ? 0 : 1;
    let classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/\d/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    if (classes <= 1) return 1;
    if (classes === 2) return 2;
    if (classes === 3) return 3;
    return 4;
  }
  const pwScore = $derived(scorePw(password));
  // "valid enough" = min 8 + at least lower, upper, digit (mirrors RegisterSchema).
  const pwOk = $derived(password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password));
  const emailOk = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  async function submit(e: Event) {
    e.preventDefault();
    nameErr = null; emailErr = null; pwErr = null; pw2Err = null; termsErr = false; emailTaken = false;

    let bad = false;
    const cleanName = cleanDisplayName(name);
    if (!cleanName) { nameErr = $t['auth.err.nameShort']; bad = true; }
    else if (!isValidDisplayName(cleanName)) { nameErr = $t['auth.err.nameInvalid']; bad = true; }
    if (!emailOk) { emailErr = $t['auth.err.emailInvalid']; bad = true; }
    if (!pwOk) { pwErr = $t['auth.err.pwWeak']; bad = true; }
    // Both empty: the password error already covers it — „stimmen nicht überein" would be false.
    if (password2 !== password || (!password2 && password)) { pw2Err = $t['auth.err.mismatch']; bad = true; }
    if (!terms) { termsErr = true; bad = true; }
    if (bad) return;

    status = 'loading';
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data?.error ?? '');
        if (code === 'name_invalid') { nameErr = $t['auth.err.nameInvalid']; status = 'idle'; return; }
        if (code === 'name_protected') { nameErr = $t['auth.err.nameProtected']; status = 'idle'; return; }
        if (res.status === 409) { emailTaken = true; status = 'idle'; return; }
        if (res.status === 429) { nameErr = $t['auth.err.tooMany']; status = 'idle'; return; }
        // 400 (e.g. profanity) or 500 → inline on the relevant field / generic
        // The server's reason is English (moderation lib) — never show it raw.
        nameErr = /inappropriate|display name/i.test(String(data?.error ?? '')) ? $t['auth.err.nameBlocked'] : $t['auth.err.generic'];
        status = 'idle';
        return;
      }
      // Auto-login after successful registration (mirrors prior behavior).
      // auth-astro's signIn() (redirect:false) resolves with a raw Response —
      // it never exposes `.error` — so failure is detected via the only
      // shape-independent signal: whether a session now exists.
      await signIn('credentials', { email: email.trim(), password, redirect: false });
      const sess = await fetch('/api/auth/session').then((r) => r.json()).catch(() => null);
      if (!sess?.user) { window.location.href = '/login'; return; }
      status = 'success';
      window.location.href = '/verify-email';
    } catch {
      nameErr = $t['auth.err.generic'];
      status = 'idle';
    }
  }
</script>

<div class="auth-card">
  <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-accent); font-weight:600;">{$t['auth.register.eyebrow']}</div>
  <h1 class="font-bricolage" style="font-weight:800; font-size:38px; letter-spacing:-0.035em; line-height:1; margin:8px 0 0; color:var(--k-ink);">
    {$t['auth.register.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.register.title.accent']}</span>{$t['auth.register.title.b']}
  </h1>

  {#if emailTaken}
    <AuthBanner kind="danger" title={$t['auth.err.emailTakenTitle']} body={$t['auth.err.emailTakenBody']}
      action={$t['auth.err.emailTakenAction']} onaction={() => (window.location.href = '/login')} />
  {/if}
  {#if status === 'success'}
    <AuthBanner kind="success" title={$t['auth.register.successTitle']} body={$t['auth.register.successBody']} />
  {/if}

  <form onsubmit={submit} style="display:flex; flex-direction:column; gap:14px; margin-top:20px;">
    <AuthField label={$t['auth.register.name']} placeholder={$t['auth.register.namePh']}
      name="name" autocomplete="nickname" value={name} error={nameErr}
      success={isValidDisplayName(cleanDisplayName(name))} oninput={(v) => { name = v; nameErr = null; }} />
    <AuthField label={$t['auth.register.email']} placeholder={$t['auth.register.emailPh']}
      type="email" name="email" autocomplete="email" value={email}
      error={emailErr} success={emailOk && !emailTaken} oninput={(v) => { email = v; emailErr = null; }} />
    <div>
      <AuthField label={$t['auth.register.pw']} placeholder={$t['auth.register.pwPh']}
        type="password" name="password" autocomplete="new-password" value={password}
        error={pwErr} showToggle oninput={(v) => { password = v; pwErr = null; }} />
      {#if password}<AuthStrength score={pwScore} />{/if}
    </div>
    <AuthField label={$t['auth.register.pw2']} placeholder={$t['auth.register.pwPh']}
      type="password" name="password2" autocomplete="new-password" value={password2}
      error={pw2Err} success={!!password2 && password2 === password} oninput={(v) => (password2 = v)} />

    <!-- The row itself is the accept-terms target, so it gets the 44px (below
         lg); the two inline legal links stay prose-height on purpose — giving
         THEM 44px hit boxes inside this label would swallow taps meant for the
         checkbox. -->
    <label class="flex min-h-[44px] lg:min-h-0" style="gap:9px; align-items:flex-start; cursor:pointer; margin-top:2px;">
      <input type="checkbox" bind:checked={terms}
        style="width:18px; height:18px; flex-shrink:0; margin-top:1px; accent-color:var(--k-ink); cursor:pointer;" />
      <span class="font-bricolage" style="font-size:12.5px; line-height:1.45; color:{termsErr ? 'var(--k-danger)' : 'var(--k-ink-soft)'};">
        {$t['auth.register.terms.a']}<a href="/terms" class="no-underline" style="color:var(--k-ink); font-weight:600; border-bottom:1px solid var(--k-ink);">{$t['auth.register.terms.termsLink']}</a>{$t['auth.register.terms.mid']}<a href="/privacy" class="no-underline" style="color:var(--k-ink); font-weight:600; border-bottom:1px solid var(--k-ink);">{$t['auth.register.terms.privacyLink']}</a>.
      </span>
    </label>

    <AuthPrimaryBtn loading={status === 'loading'}>
      {status === 'loading' ? $t['auth.register.ctaLoading'] : $t['auth.register.cta']}
    </AuthPrimaryBtn>
  </form>

  <div class="font-dmmono" style="font-size:10px; color:var(--k-ink-mute); line-height:1.5; margin-top:14px; padding-top:12px; border-top:1px dashed var(--k-rule);">{$t['auth.register.note']}</div>
  <div class="font-bricolage" style="text-align:center; font-size:13.5px; color:var(--k-ink-soft); margin-top:14px;">
    {$t['auth.register.alt']}<a href="/login" class="no-underline kiosk-tap" style="font-weight:700; color:var(--k-ink); border-bottom:2px solid var(--k-accent);">{$t['auth.register.altLink']}</a>
  </div>
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
