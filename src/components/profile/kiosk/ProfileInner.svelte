<script lang="ts">
  // Profile page orchestrator. Three top-level branches:
  //   1. !loggedIn              → state §10 "signed out" card (no redirect —
  //                                middleware no longer protects /profile).
  //   2. loggedIn && !profile   → ProfileSkeleton + a seq-guarded client
  //                                refetch of GET /api/profile/me (covers the
  //                                edge case where SSR's getProfileMe() came
  //                                back null, e.g. a session that outlived
  //                                its user record).
  //   3. else                   → ProfileTitleBlock + the real content grid.
  //      Task 9 (archiv) mounts its card into the slot marked below —
  //      HTML comments only, no placeholder copy.
  //
  // Moderation standing: fetched (seq-guarded) whenever a logged-in profile
  // is present, with a manual retry path on failure. Drives both
  // PModerationCard (§02) and the `banned` gate:
  // `banned = standing?.isBanned || profile?.isBanned` — the profile
  // snapshot (SSR-fast, from the session) flips `banned` on immediately so
  // PIdentityCard's edit action disables right away; the §09 danger banner
  // renders as soon as `banned` is true regardless of whether the standing
  // fetch has resolved — it prefers `standing.bannedAt` for the exact date
  // but falls back to an em-dash if that fetch is still pending or failed,
  // so a banned user is never left with a disabled edit button and no
  // explanation. If the standing fetch itself fails, `standingError` swaps
  // the §02 moderation slot for a fallback line with a retry link instead
  // of silently vanishing.
  //
  // Design source: design/handoffs/design_handoff_profile/jsx/kiosk-profile.jsx
  // (ProfileOwnDesktop grid) + kiosk-profile-states.jsx (§09, §10).

  import { formatDdMm, formatDdMmYyyy, type ChronikData, type ProfileMe, type ProfileStanding } from '../../../lib/profile/profileShared';
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { showSuccess, showError } from '../../../utils/toast';
  import { storedNewsletterMode, type NewsletterMode } from '../../../lib/newsletter/kiezBriefRules';
  import ProfileTitleBlock from './ProfileTitleBlock.svelte';
  import ProfileSkeleton from './states/ProfileSkeleton.svelte';
  import PCard from './atoms/PCard.svelte';
  import PBtn from './atoms/PBtn.svelte';
  import PIdentityCard from './PIdentityCard.svelte';
  import PModerationCard from './PModerationCard.svelte';
  import PKontoCard from './PKontoCard.svelte';
  import PEmailChangePanel from './PEmailChangePanel.svelte';
  import PPasswordChangePanel from './PPasswordChangePanel.svelte';
  import PDeleteAccountModal from './PDeleteAccountModal.svelte';
  import PChronikStrip from './PChronikStrip.svelte';
  import PActivityLedger from './PActivityLedger.svelte';
  import PMobileFold from './atoms/PMobileFold.svelte';
  import PStrikeDots from './atoms/PStrikeDots.svelte';

  let { initialProfile = null, initialChronik = null, loggedIn = false }: {
    initialProfile?: ProfileMe | null;
    initialChronik?: ChronikData | null;
    loggedIn?: boolean;
  } = $props();

  // Chronik is SSR-only (Task 1's getChronik(), cached 24h server-side) — no
  // client refetch/loading state needed, unlike `profile`/`standing` below.
  // Gate on stops.length too: a corrupt/edge-case empty payload (shouldn't
  // happen per chronik.ts's contract — `dabei` + `heute` are always present
  // — but cheap to guard) renders nothing rather than an empty strip shell.
  const showChronik = $derived(!!initialChronik && initialChronik.stops.length > 0);

  // svelte-ignore state_referenced_locally
  let profile = $state<ProfileMe | null>(initialProfile);

  // Seq-guarded client refetch — only runs when we land in the "logged in
  // but no SSR profile" edge case. Mirrors the seq pattern used by
  // NewsboardIndexInner's refetch() (see src/components/newsboard/kiosk/CLAUDE.md).
  let seq = 0;
  $effect(() => {
    if (!loggedIn || profile) return;
    const mySeq = ++seq;
    (async () => {
      try {
        const res = await fetch('/api/profile/me');
        if (!res.ok) return;
        const data = await res.json();
        if (mySeq !== seq) return; // stale
        profile = data.profile ?? null;
      } catch {
        /* stays on skeleton; no retry loop for task 5 scope */
      }
    })();
  });

  // ─── Moderation standing (Task 8) ──────────────────────────────────────
  let standing = $state<ProfileStanding | null>(null);
  let standingSeq = 0;
  // $state, NOT a plain let — the $effect below reads it as its re-arm guard,
  // so retryStanding()'s reset must be reactive for the effect to re-fire.
  // (The effect setting it back to true triggers one extra effect run, which
  // terminates immediately via the same guard.)
  let standingRequested = $state(false);
  let standingError = $state(false);
  $effect(() => {
    if (!profile || standingRequested) return;
    standingRequested = true;
    standingError = false;
    const mySeq = ++standingSeq;
    (async () => {
      try {
        const res = await fetch('/api/profile/standing');
        if (!res.ok) {
          if (mySeq !== standingSeq) return; // stale
          standingError = true;
          return;
        }
        const data: ProfileStanding = await res.json();
        if (mySeq !== standingSeq) return; // stale
        standing = data;
      } catch {
        if (mySeq !== standingSeq) return; // stale
        standingError = true;
      }
    })();
  });

  // Retry after a failed standing fetch — resets the request guards so the
  // $effect above fires again; the effect's own seq increment guarantees a
  // stale in-flight response from the prior attempt can't clobber this one.
  function retryStanding() {
    standingRequested = false;
    standingError = false;
  }

  // ─── Kiez-Brief switch (2026-10-04) ────────────────────────────────────
  // The weekly mail's on/off lives in the Konto card (owner: the bell panel
  // was getting crowded; and there the row was hidden from unverified
  // members, who then had nowhere to look). State here, not in PKontoCard:
  // the card is double-mounted (desktop + mobile fold). `null` = not loaded
  // (or logged out) → the row is not rendered.
  let newsMode = $state<NewsletterMode | null>(null);
  let newsVerified = $state(false);
  let newsBusy = $state(false);
  let newsRequested = false;

  $effect(() => {
    if (!profile || newsRequested) return;
    newsRequested = true;
    fetch('/api/profile/newsletter')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { newsMode = storedNewsletterMode(d.mode); newsVerified = d.emailVerified === true; } })
      .catch(() => {});
  });

  async function toggleNewsletter() {
    if (newsBusy || newsMode === null) return;
    const previous = newsMode;
    const next: NewsletterMode = previous === 'off' ? 'weekly' : 'off';
    newsMode = next; // optimistic
    newsBusy = true;
    try {
      const res = await fetch('/api/profile/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      newsMode = previous;
      showError($t['profile.konto.newsletter.error']);
    } finally {
      newsBusy = false;
    }
  }

  // ─── E-mail change (Task 8) ────────────────────────────────────────────
  // PEmailChangePanel is mounted exactly ONCE here (see that file's header
  // comment for why: PKontoCard is double-mounted — desktop card + mobile
  // fold — and a stateful panel with local input fields would desync
  // across two independent mounts). `emailPanelOpen` gates that single
  // mount; PKontoCard (both mounts) only gets `pendingEmail` + the
  // resend/cancel handlers as props so its §08 banner always reflects the
  // same upstream state the panel would show.
  let emailPanelOpen = $state(false);

  function openEmailPanel() {
    emailPanelOpen = true;
  }
  function closeEmailPanel() {
    emailPanelOpen = false;
  }
  function handleEmailStarted(newEmail: string) {
    if (!profile) return;
    profile = { ...profile, pendingEmail: newEmail };
  }
  // Shared by both PKontoCard's §08 banner and PEmailChangePanel's stage-02
  // links — same function reference in both places, so resend/cancel
  // behavior can never drift between the two surfaces.
  async function resendEmailChange() {
    try {
      const res = await fetch('/api/profile/email-change/resend', { method: 'POST' });
      if (res.ok) {
        showSuccess($t['profile.email.stage2.resendOk']);
      } else if (res.status === 429) {
        showError($t['profile.email.err.throttled']);
      } else {
        showError($t['profile.email.err.config']);
      }
    } catch {
      showError($t['profile.email.err.config']);
    }
  }
  async function cancelEmailChange() {
    try {
      await fetch('/api/profile/email-change/cancel', { method: 'POST' });
    } catch {
      // /cancel is idempotent + always-200 server-side; a dropped response
      // here just means we didn't get the ack — clear local state anyway so
      // the UI isn't stuck (a stale server-side pendingEmail is harmless:
      // the banner would reappear on the next /me fetch and can be
      // cancelled again).
    }
    if (!profile) return;
    profile = { ...profile, pendingEmail: null };
    emailPanelOpen = false;
  }

  // Reconciliation fallback: if this tab confirmed the change in a
  // DIFFERENT tab/browser (e.g. the link was opened from a phone's mail
  // app while this desktop tab still shows the pending banner), regaining
  // focus re-checks /me so the banner doesn't linger indefinitely after an
  // out-of-band confirm. Seq-guarded like every other fetch in this file.
  let reconcileSeq = 0;
  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (!profile?.pendingEmail) return;
    const mySeq = ++reconcileSeq;
    (async () => {
      try {
        const res = await fetch('/api/profile/me');
        if (!res.ok) return;
        const data = await res.json();
        if (mySeq !== reconcileSeq) return; // stale
        if (!profile || !data?.profile) return;
        profile = { ...profile, email: data.profile.email, pendingEmail: data.profile.pendingEmail ?? null };
      } catch {
        /* silent — banner just stays until the next successful reconcile */
      }
    })();
  }
  $effect(() => {
    if (!loggedIn) return;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  // ─── Password change (Task 9) ──────────────────────────────────────────
  // Same single-mount reasoning as the e-mail panel above (PKontoCard is
  // double-mounted; a stateful form would desync). Own gate, own grid slot
  // — the two panels are independent and mutually openable (no design
  // reason to force one closed when the other opens), so this doesn't
  // reuse `emailPanelOpen`.
  let pwPanelOpen = $state(false);
  function openPwPanel() {
    pwPanelOpen = true;
  }
  function closePwPanel() {
    pwPanelOpen = false;
  }

  // ─── Delete account (Task 10) ──────────────────────────────────────────
  // Same single-mount reasoning as the email/password panels: PKontoCard is
  // double-mounted, so the stateful modal lives here instead, gated by
  // `deleteModalOpen`. Both PKontoCard mounts get `deletionScheduledAt` +
  // `deletionDateLabel` (pre-formatted so PKontoCard stays a pure
  // props-in/markup-out component, same reasoning as `bannedAtLabel` below)
  // plus the SAME `openDeleteModal`/`cancelDeletionRequest` function
  // references, so the Gefahrenzone/banner and the modal's own submit path
  // can never drift.
  //
  // NOTHING here deletes or anonymizes data — scheduling only sets
  // `deletionScheduledAt` via POST /api/profile/delete-account/schedule;
  // the day-7 anonymization pipeline is Task 11.
  let deleteModalOpen = $state(false);
  function openDeleteModal() {
    deleteModalOpen = true;
  }
  function closeDeleteModal() {
    deleteModalOpen = false;
  }
  function handleDeletionScheduled(deletionScheduledAt: string) {
    if (!profile) return;
    profile = { ...profile, deletionScheduledAt };
  }
  async function cancelDeletionRequest() {
    try {
      await fetch('/api/profile/delete-account/cancel', { method: 'POST' });
    } catch {
      // /cancel is idempotent + always-200 server-side; a dropped response
      // here just means we didn't get the ack — clear local state anyway
      // (mirrors cancelEmailChange()'s same fallback reasoning above).
    }
    if (!profile) return;
    profile = { ...profile, deletionScheduledAt: null };
  }

  const banned = $derived((standing?.isBanned ?? false) || (profile?.isBanned ?? false));

  const bannedAtLabel = $derived(standing?.bannedAt ? formatDdMm(standing.bannedAt, $locale) : null);

  const deletionDateLabel = $derived(
    profile?.deletionScheduledAt ? formatDdMmYyyy(profile.deletionScheduledAt, $locale) : null
  );

  // Mirrors PModerationCard's own accent derivation — the mobile fold
  // wraps the "bare" content of that same card, so its top-rule must track
  // the same clean/warn logic rather than a static warn (the design source
  // hardcodes warn because its mock always demos the rejected-content
  // anatomy; real data can be clean).
  const modAccent = $derived(
    standing && standing.strikes === 0 && standing.rejected.length === 0
      ? 'var(--k-success)'
      : 'var(--k-warn)'
  );
</script>

{#if !loggedIn}
  <!-- State §10 — signed out. Replaces the legacy 🔒 card; no hard redirect. -->
  <div class="min-h-[55vh] flex items-center justify-center px-4 py-16">
    <PCard pad={28}>
      <div style="max-width: 340px; text-align: center;">
        <div
          class="font-instrument italic"
          style="font-size: 15px; color: var(--k-ink-soft); margin-bottom: 16px;"
        >
          {$t['profile.state.loggedout']}
        </div>
        <PBtn primary small href="/login">{$t['profile.state.login']}</PBtn>
      </div>
    </PCard>
  </div>
{:else if !profile}
  <ProfileSkeleton />
{:else}
  <ProfileTitleBlock handle={profile.handle} since={profile.memberSince} />
  <div class="px-4 lg:px-9 py-6">
    {#if banned}
      <!-- State §09 — gesperrt. Profile stays fully readable; write actions
           (edit) are disabled via the `banned` prop threaded into PIdentityCard.
           bannedAtLabel may be null (standing fetch failed or still pending) —
           fall back to an em-dash rather than hiding the banner entirely. -->
      <div
        class="mb-5"
        style="
          padding: 8px 11px; background: #f6e3e3; border: 1.5px solid var(--k-danger);
          border-radius: var(--k-radius-sm); font-family: var(--k-font-mono); font-size: 9.5px;
          color: var(--k-ink-soft); line-height: 1.55;
        "
      >
        <b style="color: var(--k-danger); font-weight: 700;">✕</b>
        {tStr($t['profile.state.banned'], { d: bannedAtLabel ?? '—' })}
      </div>
    {/if}
    <!--
      Grid at all breakpoints. Desktop (lg+) uses explicit line placement:
      col 1 = identity → moderation → konto (rows 1–3), col 2 = archiv
      (spans all 3 rows). Below lg the same grid collapses to a single
      implicit column and `order-*` utilities re-sequence it to the
      ProfileOwnMobile stack: identity → archiv → moderation fold → konto
      fold. PIdentityCard and PActivityLedger hold internal state (edit/
      avatar, own fetch) so each is mounted exactly ONCE and just moves via
      CSS; PModerationCard/PKontoCard are stateless/props-driven, so their
      desktop-card and mobile-fold ("bare" prop, wrapped in PMobileFold)
      instances are both mounted, sourcing from the same `standing`/
      `profile` state lifted here. See src/components/profile/kiosk/CLAUDE.md.

      `min-w-0` on every direct grid-item wrapper below is load-bearing: a
      CSS grid item's automatic minimum width defaults to its content's
      min-content size, and below `lg` (single implicit column, no explicit
      `grid-template-columns`) that lets any one item's non-wrapping row
      (e.g. the identity card's 4-col stat grid) blow the whole column out
      wider than the viewport — invisibly, since `overflow-x: clip` on
      html/body (see root CLAUDE.md) hides the resulting cut-off content
      instead of showing a scrollbar. `min-w-0` resets the automatic
      minimum to 0 so the column tracks the grid container's own width.
    -->
    <div class="grid gap-[26px] items-start lg:grid-cols-[384px_1fr]">
      <!-- Identity — single mount -->
      <div class="order-1 min-w-0 lg:col-start-1 lg:row-start-1">
        <PIdentityCard
          profile={profile}
          banned={banned}
          onSaved={(p) => {
            if (!profile) return;
            profile = { ...profile, name: p.name, hobbies: p.hobbies, motto: p.motto, memberType: p.memberType };
          }}
        />
      </div>

      <!-- Moderation — desktop card (lg+ only) -->
      <div class="hidden min-w-0 lg:block lg:col-start-1 lg:row-start-2">
        {#if standing}
          <PModerationCard standing={standing} />
        {:else if standingError}
          <PCard accent="var(--k-warn)">
            <div class="font-dmmono" style="font-size: 10.5px; color: var(--k-ink-mute); line-height: 1.55;">
              {$t['profile.mod.loadfailed']}
              <button
                type="button"
                onclick={retryStanding}
                style="font-family: var(--k-font-mono); font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); background: none; border: none; border-bottom: 1.5px solid var(--k-ink-mute); padding: 0; cursor: pointer;"
              >{$t['profile.save.retry']}</button>
            </div>
          </PCard>
        {/if}
      </div>

      <!-- Konto — desktop card (lg+ only) -->
      <div class="hidden min-w-0 lg:block lg:col-start-1 lg:row-start-3">
        <PKontoCard
          email={profile.email}
          pendingEmail={profile.pendingEmail}
          showBanner={!emailPanelOpen}
          onChangeEmail={openEmailPanel}
          onResendEmail={resendEmailChange}
          onCancelEmail={cancelEmailChange}
          onChangePassword={openPwPanel}
          newsletterMode={newsMode}
          newsletterVerified={newsVerified}
          newsletterBusy={newsBusy}
          onToggleNewsletter={toggleNewsletter}
          deletionScheduledAt={profile.deletionScheduledAt}
          deletionDateLabel={deletionDateLabel}
          onOpenDelete={openDeleteModal}
          onCancelDeletion={cancelDeletionRequest}
        />
      </div>

      <!--
        E-mail change panel (Task 8) — SINGLE mount, own grid slot directly
        below the Konto card/fold on both breakpoints. See this file's
        "E-mail change" comment block above + PEmailChangePanel.svelte's
        header for why it can't be mounted inside PKontoCard itself (that
        component is double-mounted; a stateful panel would desync).
        `lg:row-start-4` sits under Konto's `lg:row-start-3` in the same
        column — the right column's `lg:row-span-3` only reserves rows 1–3,
        so this doesn't force Archiv taller.
      -->
      {#if emailPanelOpen}
        <div class="order-5 min-w-0 lg:col-start-1 lg:row-start-4">
          <PEmailChangePanel
            pendingEmail={profile.pendingEmail}
            onStarted={handleEmailStarted}
            onResend={resendEmailChange}
            onCancel={cancelEmailChange}
            onClose={closeEmailPanel}
          />
        </div>
      {/if}

      <!--
        Password change panel (Task 9) — same single-mount reasoning as the
        e-mail panel above. Own grid slot one row further down
        (`lg:row-start-5` / `order-6`) so it never collides with the e-mail
        panel's slot when both happen to be open at once; still inside the
        left column, still below the right column's `lg:row-span-3` reserve.
      -->
      {#if pwPanelOpen}
        <div class="order-6 min-w-0 lg:col-start-1 lg:row-start-5">
          <PPasswordChangePanel email={profile.email} onClose={closePwPanel} />
        </div>
      {/if}

      <!--
        Right column — single mount, spans the right column on desktop.
        Nested flex column (not a second row-line placement) so Chronik +
        Archiv stack tightly regardless of the left column's row heights —
        mirrors kiosk-profile.jsx's ProfileOwnDesktop right-column div
        directly (its own `flexDirection: column, gap: 20`), rather than
        trying to align Chronik/Archiv to the left column's per-card grid
        rows (identity/moderation/konto), which would leave a dead gap
        under a short Chronik strip whenever the identity card's row is
        taller than it. On mobile this single order-2 slot still lands
        directly after the identity card and before Archiv, since Chronik
        is nested ahead of Archiv inside it.
      -->
      <div class="order-2 min-w-0 flex flex-col gap-5 lg:col-start-2 lg:row-start-1 lg:row-span-3">
        {#if showChronik && initialChronik}
          <PChronikStrip chronik={initialChronik} />
        {/if}
        <PActivityLedger />
      </div>

      <!-- Moderation — mobile fold (below lg only) -->
      <div class="order-3 min-w-0 lg:hidden">
        {#if standing}
          <PMobileFold title={$t['profile.mod.title']} accent={modAccent} open>
            {#snippet badge()}
              <PStrikeDots strikes={standing.strikes} />
            {/snippet}
            <PModerationCard standing={standing} bare />
          </PMobileFold>
        {:else if standingError}
          <PMobileFold title={$t['profile.mod.title']} accent="var(--k-warn)" open>
            <div class="font-dmmono" style="font-size: 10.5px; color: var(--k-ink-mute); line-height: 1.55;">
              {$t['profile.mod.loadfailed']}
              <button
                type="button"
                onclick={retryStanding}
                style="font-family: var(--k-font-mono); font-size: 10.5px; font-weight: 700; color: var(--k-ink-mute); background: none; border: none; border-bottom: 1.5px solid var(--k-ink-mute); padding: 0; cursor: pointer;"
              >{$t['profile.save.retry']}</button>
            </div>
          </PMobileFold>
        {/if}
      </div>

      <!-- Konto — mobile fold (below lg only) -->
      <div class="order-4 min-w-0 lg:hidden">
        <PMobileFold title={$t['profile.konto.title']} open>
          <PKontoCard
            email={profile.email}
            pendingEmail={profile.pendingEmail}
            showBanner={!emailPanelOpen}
            onChangeEmail={openEmailPanel}
            onResendEmail={resendEmailChange}
            onCancelEmail={cancelEmailChange}
            onChangePassword={openPwPanel}
            newsletterMode={newsMode}
            newsletterVerified={newsVerified}
            newsletterBusy={newsBusy}
            onToggleNewsletter={toggleNewsletter}
            deletionScheduledAt={profile.deletionScheduledAt}
            deletionDateLabel={deletionDateLabel}
            onOpenDelete={openDeleteModal}
            onCancelDeletion={cancelDeletionRequest}
            bare
          />
        </PMobileFold>
      </div>
    </div>
  </div>

  <!--
    Delete-account modal (Task 10) — single mount, ALWAYS in the DOM
    (native <dialog>, gated by `open`), same convention as
    KioskReportModal.svelte's callers. Lives outside the grid entirely: a
    shown <dialog> renders in the browser's top layer regardless of DOM
    position, so it needs no grid placement / `min-w-0`.
  -->
  <PDeleteAccountModal
    open={deleteModalOpen}
    handle={profile.handle}
    onClose={closeDeleteModal}
    onScheduled={handleDeletionScheduled}
  />
{/if}
