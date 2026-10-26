<script lang="ts">
  import { onDestroy } from 'svelte';
  import { signIn } from 'auth-astro/client';
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import { LoginSchema } from '../../../schemas/auth.schema';
  import AuthField from './primitives/AuthField.svelte';
  import AuthPrimaryBtn from './primitives/AuthPrimaryBtn.svelte';
  import AuthBanner from './primitives/AuthBanner.svelte';
  import { safeInternalPath } from '../../../lib/auth/safeRedirect';
  import DemoDoor from '../../demo/DemoDoor.svelte';

  // Read-only demo deployment (spec 2026-10-26): two buttons instead of the password form.
  let { demo = false }: { demo?: boolean } = $props();

  // Post-login destination: honor ?redirect= from the middleware gate.
  // Validation lives in safeInternalPath (URL-normalization based — see
  // that file for why startsWith checks are not enough).
  function postLoginTarget(): string {
    try {
      return safeInternalPath(new URLSearchParams(window.location.search).get('redirect'), '/forum');
    } catch {
      return '/forum';
    }
  }

  let email = $state('');
  let password = $state('');
  let emailErr = $state<string | null>(null);
  let pwErr = $state<string | null>(null);
  let credErr = $state(false);     // generic wrong email-or-password
  let status = $state<'idle' | 'loading' | 'success'>('idle');

  // State 05 — locked out. >0 seconds remaining → danger banner + disabled form.
  let lockSec = $state(0);
  let lockTimer: ReturnType<typeof setInterval> | null = null;
  const locked = $derived(lockSec > 0);
  const lockLabel = $derived(`${Math.floor(lockSec / 60)}:${String(lockSec % 60).padStart(2, '0')}`);

  // Ban enforcement (design A): correct password on a banned account.
  // Replaces the whole card — there is nothing else to do on this page.
  let bannedState = $state(false);

  // Signed-out confirmation strap (?abgemeldet=1) — set by every logout path.
  // Param is stripped via replaceState so reload/bookmark doesn't re-show it.
  let signedOut = $state(false);
  {
    const params = new URLSearchParams(window.location.search);
    if (params.get('abgemeldet') === '1') {
      signedOut = true;
      params.delete('abgemeldet');
      const qs = params.toString();
      history.replaceState(history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }

  // Gate hint: the middleware bounced a logged-out visitor here from a
  // gated page (?redirect=/calendar…). Name the destination so the door
  // explains itself; unknown paths fall back to the generic line.
  const DEST_KEYS: [string, string][] = [
    ['/forum', 'forum'], ['/topics', 'forum'], ['/announcements', 'forum'], ['/recommendations', 'forum'],
    ['/calendar', 'calendar'], ['/events', 'calendar'],
    ['/newsboard', 'news'], ['/marketplace', 'marketplace'],
    ['/bookmarks', 'bookmarks'], ['/search', 'search'],
    ['/nachbarn', 'nachbarn'], ['/steckbrief', 'steckbrief'],
  ];
  const redirectDest = $derived.by(() => {
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (!raw) return null;
    const path = safeInternalPath(raw, '');
    if (!path) return null;
    const hit = DEST_KEYS.find(([prefix]) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
    return hit ? hit[1] : 'generic';
  });
  const redirectHint = $derived(
    redirectDest === null ? '' :
    redirectDest === 'generic' ? $t['auth.login.hintGeneric'] :
    tStr($t['auth.login.hint'], { where: ($t as Record<string, string>)[`auth.login.dest.${redirectDest}`] ?? '' })
  );

  function startLock(sec: number) {
    lockSec = Math.max(1, Math.round(sec));
    credErr = false;
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = setInterval(() => {
      lockSec -= 1;
      if (lockSec <= 0 && lockTimer) {
        clearInterval(lockTimer);
        lockTimer = null;
      }
    }, 1000);
  }
  onDestroy(() => {
    if (lockTimer) clearInterval(lockTimer);
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (locked) return;
    emailErr = null; pwErr = null; credErr = false;

    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      if (fields.email) emailErr = $t['auth.err.emailInvalid'];
      if (fields.password) pwErr = $t['auth.err.pwShort'];
      return;
    }

    status = 'loading';
    try {
      await signIn('credentials', {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });
      // auth-astro's signIn() (redirect:false) resolves with a raw Response —
      // it never exposes `.error` — so failure is detected via the only
      // shape-independent signal: whether a session now exists. Preserves
      // anti-enumeration: still ONE generic banner for all failure kinds.
      const sess = await fetch('/api/auth/session').then((r) => r.json()).catch(() => null);
      if (!sess?.user) {
        // Distinguish lockout (state 05) from plain bad credentials via the
        // peek-only status endpoint — reveals lockout state, never existence.
        try {
          const res = await fetch('/api/auth/login-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: parsed.data.email }),
          });
          const data = await res.json().catch(() => ({}));
          if (data?.banned) {
            bannedState = true;
            status = 'idle';
            return;
          }
          if (data?.locked) {
            startLock(data.retryAfterSec);
            status = 'idle';
            return;
          }
        } catch { /* fall through to generic */ }
        // Anti-enumeration: ONE generic message for wrong-pw AND email-not-found.
        credErr = true;
        status = 'idle';
        return;
      }
      status = 'success';
      window.location.href = postLoginTarget();
    } catch {
      credErr = true;
      status = 'idle';
    }
  }
</script>

<div class="auth-card" class:auth-card-banned={bannedState}>
  {#if bannedState}
    <div style="text-align:center;">
      <div class="banned-roundel" aria-hidden="true">✕</div>
      <h1 class="font-bricolage" style="font-weight:800; font-size:26px; letter-spacing:-0.025em; margin:0; color:var(--k-ink);">
        {$t['auth.banned.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-danger);">{$t['auth.banned.title.accent']}</span>
      </h1>
      <p class="font-bricolage" style="font-size:13.5px; line-height:1.55; color:var(--k-ink-soft); margin:10px 0 0;">
        {$t['auth.banned.body']}
      </p>
      <div class="font-dmmono banned-contact">
        {$t['auth.banned.contactQ']}<br />{$t['auth.banned.contactMail']}
      </div>
    </div>
  {:else}
    <div class="font-dmmono" style="font-size:11px; letter-spacing:0.18em; color:var(--k-accent); font-weight:600;">{$t['auth.login.eyebrow']}</div>
    <h1 class="font-bricolage" style="font-weight:800; font-size:38px; letter-spacing:-0.035em; line-height:1; margin:8px 0 0; color:var(--k-ink);">
      {$t['auth.login.title.a']}<span class="font-instrument" style="font-style:italic; font-weight:400; color:var(--k-accent);">{$t['auth.login.title.accent']}</span>{$t['auth.login.title.b']}
    </h1>

    {#if signedOut}
      <div
        class="font-dmmono"
        role="status"
        style="margin-bottom: 14px; padding: 9px 12px; border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm); background: var(--k-paper-warm); font-size: 10.5px; letter-spacing: 0.08em; color: var(--k-ink-soft);"
      >
        ✓ {$t['auth.login.signedout']}
      </div>
    {/if}
    {#if redirectHint && !signedOut && status !== 'success'}
      <div
        class="font-dmmono"
        role="status"
        style="margin-top: 14px; padding: 9px 12px; border: 1.5px solid var(--k-accent); border-radius: var(--k-radius-sm); background: var(--k-paper-warm); font-size: 10.5px; letter-spacing: 0.08em; color: var(--k-ink-soft);"
      >
        → {redirectHint}
      </div>
    {/if}

    {#if locked}
      <AuthBanner kind="danger" title={$t['auth.err.lockedTitle']}
        body={`${$t['auth.err.lockedBody.a']}${lockLabel}${$t['auth.err.lockedBody.b']}`} />
    {/if}
    {#if credErr}
      <AuthBanner kind="danger" title={$t['auth.err.credentials']} />
    {/if}
    {#if status === 'success'}
      <AuthBanner kind="success" title={$t['auth.login.successTitle']} body={$t['auth.login.successBody']} />
    {/if}

    {#if demo}
      <DemoDoor />
    {:else}
    <form onsubmit={submit} style="display:flex; flex-direction:column; gap:16px; margin-top:22px;">
      <AuthField
        label={$t['auth.login.email']} placeholder={$t['auth.login.emailPh']}
        type="email" name="email" autocomplete="email"
        value={email} error={emailErr} disabled={locked}
        oninput={(v) => (email = v)} />
      <div>
        <AuthField
          label={$t['auth.login.pw']} placeholder={$t['auth.login.pwPh']}
          type="password" name="password" autocomplete="current-password"
          value={password} error={pwErr} showToggle disabled={locked}
          oninput={(v) => (password = v)} />
        <div style="text-align:right; margin-top:7px;">
          <a href="/forgot-password" class="font-dmmono no-underline kiosk-tap" style="font-size:11px; color:var(--k-ink-soft); border-bottom:1px dashed var(--k-ink-mute);">{$t['auth.login.forgot']}</a>
        </div>
      </div>
      <AuthPrimaryBtn loading={status === 'loading'} disabled={locked}>
        {status === 'loading' ? $t['auth.login.ctaLoading'] : status === 'success' ? $t['auth.login.ctaDone'] : $t['auth.login.cta']}
      </AuthPrimaryBtn>
    </form>

    <div class="flex items-center" style="gap:12px; margin:20px 0 16px;">
      <div style="flex:1; border-top:1px dashed var(--k-rule);"></div>
      <span class="font-dmmono uppercase" style="font-size:9.5px; color:var(--k-ink-mute); letter-spacing:0.16em;">{$t['auth.login.or']}</span>
      <div style="flex:1; border-top:1px dashed var(--k-rule);"></div>
    </div>
    <div class="font-bricolage" style="text-align:center; font-size:13.5px; color:var(--k-ink-soft);">
      {$t['auth.login.alt']}<a href="/register" class="no-underline kiosk-tap" style="font-weight:700; color:var(--k-ink); border-bottom:2px solid var(--k-accent);">{$t['auth.login.altLink']}</a>
    </div>
    {/if}
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
  .auth-card-banned {
    border-top-color: var(--k-danger);
    box-shadow: 3px 3px 0 var(--k-danger);
  }
  .banned-roundel {
    width: 46px; height: 46px; margin: 0 auto 12px;
    background: var(--k-danger); border-radius: 50%;
    border: 1.5px solid var(--k-ink);
    display: flex; align-items: center; justify-content: center;
    color: var(--k-paper); font-size: 20px; font-weight: 700;
  }
  .banned-contact {
    font-size: 10.5px; color: var(--k-ink-mute); margin-top: 14px;
    padding: 9px 12px; background: var(--k-paper-soft);
    border-radius: 8px; border: 1px solid var(--k-rule); line-height: 1.5;
  }
</style>
