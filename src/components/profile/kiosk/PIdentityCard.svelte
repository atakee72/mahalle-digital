<script lang="ts">
  // Identity card — read state (avatar + name + handle/since + verified pill
  // + stats ledger + hobby chips + "Profil bearbeiten") and in-card edit
  // state (name field + removable hobby chips + add-hobby ghost input +
  // display-only email box + Speichern/Abbrechen). Editing happens IN the
  // card — no modal, no separate screen.
  //
  // Save is optimistic: Speichern validates client-side, flips straight to
  // read state showing the new values + a "speichert …" chip, then POSTs.
  // The card never mutates its own source of truth — `profile` stays the
  // parent's (ProfileInner) $state; while a save is in flight the read
  // state shows `optimisticOverride` instead. Success calls onSaved() (the
  // parent updates `profile`, which flows back down) and clears the
  // override; failure clears the override (so the real `profile` values
  // show again) and returns to edit state with a danger banner + retry —
  // editName/editHobbies are left untouched so retry resends the same
  // payload.
  //
  // Design source: kiosk-profile.jsx (PIdentityCard, PAvatar, PHobbyChip) +
  // kiosk-profile-flows.jsx §01 (ProfileEditDesktop) + kiosk-profile-states.jsx
  // §04 (speichert) / §05 (save failed).

  import { onDestroy } from 'svelte';
  import { cleanDisplayName } from '../../../lib/profile/nameRules';
  import type { ProfileMe } from '../../../lib/profile/profileShared';
  import {
    PROFILE_NAME_REGEX,
    HOBBY_MAX_COUNT,
    HOBBY_MAX_LEN,
    MOTTO_MAX_LEN,
    AVATAR_MAX_BYTES,
    AVATAR_ACCEPTED_TYPES,
  } from '../../../lib/profile/profileShared';
  import { t, tStr } from '../../../lib/kiosk-i18n';
  import PCard from './atoms/PCard.svelte';
  import PBtn from './atoms/PBtn.svelte';
  import PAvatar from './atoms/PAvatar.svelte';
  import PHobbyChip from './atoms/PHobbyChip.svelte';
  import PAvatarUploadPanel from './atoms/PAvatarUploadPanel.svelte';

  let {
    profile,
    banned,
    onSaved,
  }: {
    profile: ProfileMe;
    banned: boolean;
    onSaved: (p: { name: string; hobbies: string[]; motto: string | null }) => void;
  } = $props();

  // ─── Read-state display value (real profile, unless a save is in flight) ──
  type Editable = { name: string; hobbies: string[]; motto: string | null };
  let optimisticOverride = $state<Editable | null>(null);
  const displayName = $derived(optimisticOverride?.name ?? profile.name);
  const displayHobbies = $derived(optimisticOverride?.hobbies ?? profile.hobbies);
  const displayMotto = $derived(optimisticOverride ? optimisticOverride.motto : profile.motto);

  // ─── Edit state ────────────────────────────────────────────────────────
  let editing = $state(false);
  let editName = $state('');
  let editMotto = $state('');
  let editHobbies = $state<string[]>([]);
  let newHobby = $state('');
  let newlyAdded = $state<string[]>([]); // hobbies added THIS edit session — chip-pop-in once
  let nameError = $state<string | null>(null);

  type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
  let saveState = $state<SaveState>('idle');
  let saveError = $state<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  let nameFocused = $state(false);
  let mottoFocused = $state(false);

  // Sequence guard — a stale in-flight submit() must never clobber state
  // written by a newer one. Mirrors ProfileInner.svelte's seq pattern.
  let saveSeq = 0;

  onDestroy(() => clearTimeout(savedTimer));

  // ─── Avatar upload (5 states) ──────────────────────────────────────────
  // idle (no panel — header ÄNDERN chip only) → picking (dropzone) →
  // uploading (XHR + real progress) → error (concrete reason, old image
  // untouched) → saved (✓ badge, then back to idle with the new image).
  // Independent of the name/hobbies edit flow above — the panel renders
  // under whichever header (read or edit state) is currently showing, so
  // the rest of the card stays usable while an upload is in flight.
  type AvatarState = 'idle' | 'picking' | 'uploading' | 'error' | 'saved';
  let avatarState = $state<AvatarState>('idle');
  // Once a fresh URL comes back from the server it beats profile.image —
  // the server session snapshot (and initialProfile from this page load)
  // is otherwise stale until next login/SSR.
  let avatarUrl = $state<string | null>(null);
  let avatarPercent = $state<number | null>(null);
  let avatarErrorKey = $state<'size' | 'format' | 'network' | null>(null);
  let selectedAvatarFile: File | null = null; // remembered for network-error retry
  let avatarXhr: XMLHttpRequest | null = null;
  let avatarSavedTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    clearTimeout(avatarSavedTimer);
    avatarXhr?.abort();
  });

  const displayImage = $derived(avatarUrl ?? profile.image);

  function openAvatarPicker() {
    if (banned) return;
    // Reopening the picker (e.g. re-clicking ÄNDERN) while an upload is in
    // flight must actually abort it — otherwise the old XHR keeps running
    // in the background and can silently flip the state to "saved" later,
    // out of step with whatever the user is doing by then.
    if (avatarState === 'uploading') {
      avatarXhr?.abort();
      avatarXhr = null;
    }
    avatarState = 'picking';
    avatarPercent = null;
    avatarErrorKey = null;
  }

  function validateAndUploadAvatar(file: File) {
    if (file.size > AVATAR_MAX_BYTES) {
      avatarState = 'error';
      avatarErrorKey = 'size';
      return;
    }
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type as (typeof AVATAR_ACCEPTED_TYPES)[number])) {
      avatarState = 'error';
      avatarErrorKey = 'format';
      return;
    }
    selectedAvatarFile = file;
    uploadAvatar(file);
  }

  function uploadAvatar(file: File) {
    avatarState = 'uploading';
    avatarPercent = null;
    avatarErrorKey = null;

    const formData = new FormData();
    formData.append('image', file);

    const xhr = new XMLHttpRequest();
    avatarXhr = xhr;
    xhr.open('POST', '/api/profile/avatar');

    xhr.upload.onprogress = (e) => {
      if (avatarXhr !== xhr) return;
      if (e.lengthComputable) avatarPercent = Math.round((e.loaded / e.total) * 100);
    };

    xhr.onload = () => {
      if (avatarXhr !== xhr) return; // superseded/cancelled
      avatarXhr = null;
      let json: any = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body — falls through to the generic network error */
      }
      if (xhr.status === 200 && typeof json?.url === 'string') {
        avatarUrl = json.url;
        avatarPercent = null;
        avatarState = 'saved';
        window.dispatchEvent(new CustomEvent('profile:avatar-updated', { detail: { url: json.url } }));
        clearTimeout(avatarSavedTimer);
        avatarSavedTimer = setTimeout(() => {
          if (avatarState === 'saved') avatarState = 'idle';
        }, 1500);
        return;
      }
      const code = typeof json?.error === 'string' ? json.error : null;
      avatarState = 'error';
      avatarErrorKey = code === 'file_too_large' ? 'size' : code === 'bad_type' ? 'format' : 'network';
    };

    xhr.onerror = () => {
      if (avatarXhr !== xhr) return;
      avatarXhr = null;
      avatarState = 'error';
      avatarErrorKey = 'network';
    };

    xhr.send(formData);
  }

  function cancelAvatarUpload() {
    avatarXhr?.abort();
    avatarXhr = null;
    avatarPercent = null;
    avatarErrorKey = null;
    avatarState = 'picking'; // silent — no error banner
  }

  function retryAvatarUpload() {
    if (selectedAvatarFile) uploadAvatar(selectedAvatarFile);
  }

  function pickOtherAvatar() {
    avatarState = 'picking';
    avatarErrorKey = null;
  }

  function startEdit() {
    if (banned) return;
    editName = displayName;
    editMotto = displayMotto ?? '';
    editHobbies = [...displayHobbies];
    newHobby = '';
    newlyAdded = [];
    nameError = null;
    saveState = 'idle';
    saveError = null;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    saveState = 'idle';
    saveError = null;
    nameError = null;
  }

  function addHobby() {
    const trimmed = newHobby.trim().slice(0, HOBBY_MAX_LEN);
    if (!trimmed) return;
    if (editHobbies.length >= HOBBY_MAX_COUNT) return;
    if (editHobbies.some((h) => h.toLowerCase() === trimmed.toLowerCase())) {
      newHobby = '';
      return;
    }
    editHobbies = [...editHobbies, trimmed];
    newlyAdded = [...newlyAdded, trimmed];
    newHobby = '';
  }

  function handleHobbyKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addHobby();
    }
  }

  function removeHobby(h: string) {
    editHobbies = editHobbies.filter((x) => x !== h);
  }

  async function submit(payload: Editable, mySeq: number) {
    saveState = 'saving';
    saveError = null;
    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg: string | null = null;
        try {
          const j = await res.json();
          msg = typeof j?.error === 'string' ? j.error : null;
        } catch {
          /* non-JSON error body — fall through to generic banner copy */
        }
        if (mySeq !== saveSeq) return; // stale — a newer save superseded this one
        optimisticOverride = null;
        editing = true;
        saveState = 'failed';
        // Machine codes from /api/users/update get real copy; anything else
        // (e.g. the moderation lib's English reason) passes through as before.
        saveError =
          msg === 'name_protected' ? $t['auth.err.nameProtected']
          : msg === 'name_invalid' ? $t['profile.edit.name.hint']
          : msg;
        return;
      }
      const json = await res.json();
      const echo: Editable = {
        name: typeof json.name === 'string' ? json.name : payload.name,
        hobbies: Array.isArray(json.hobbies) ? json.hobbies : payload.hobbies,
        motto: typeof json.motto === 'string' ? json.motto : null,
      };
      if (mySeq !== saveSeq) return; // stale
      onSaved(echo);
      optimisticOverride = null;
      saveState = 'saved';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        if (saveState === 'saved') saveState = 'idle';
      }, 1500);
    } catch {
      if (mySeq !== saveSeq) return; // stale
      optimisticOverride = null;
      editing = true;
      saveState = 'failed';
      saveError = null; // network failure — banner falls back to generic copy
    }
  }

  function handleSave() {
    const trimmed = cleanDisplayName(editName);
    if (!PROFILE_NAME_REGEX.test(trimmed)) {
      nameError = $t['profile.edit.name.hint'];
      return;
    }
    nameError = null;
    // Empty trimmed motto is sent as '' (not omitted) — the server treats an
    // explicit '' as "clear it" ($unset) vs. an absent field ("leave as is").
    const trimmedMotto = editMotto.trim().slice(0, MOTTO_MAX_LEN);
    const payload: Editable = { name: trimmed, hobbies: [...editHobbies], motto: trimmedMotto || '' };
    const mySeq = ++saveSeq;
    optimisticOverride = { ...payload, motto: trimmedMotto || null };
    editing = false;
    submit(payload, mySeq);
  }

  const sinceLine = $derived(`@${profile.handle} · ${tStr($t['profile.since'], { y: profile.memberSince })}`);
  const nameBorder = $derived(nameError ? 'var(--k-danger)' : nameFocused ? 'var(--k-ink)' : 'var(--k-rule)');
</script>

<PCard>
  {#if !editing}
    <!-- ═══ Read state ═══ -->
    <div style="display: flex; gap: 16px; align-items: flex-start;">
      <PAvatar
        name={displayName}
        image={displayImage}
        editable
        onOpenUpload={openAvatarPicker}
        showSavedBadge={avatarState === 'saved'}
      />
      <div style="min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <h2
            class="font-bricolage"
            style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0; line-height: 1.05;"
          >{displayName}</h2>
          {#if saveState === 'saving' || saveState === 'saved'}
            <span
              class="prof-save-chip font-dmmono"
              style="padding: 3px 9px; background: var(--k-paper-soft); border: 1.5px solid var(--k-ink); border-radius: 999px; font-size: 9px; color: var(--k-ink-mute);"
            >{saveState === 'saving' ? $t['profile.chip.saving'] : $t['profile.chip.saved']}</span>
          {/if}
        </div>
        <div class="font-dmmono" style="font-size: 11px; color: var(--k-ink-mute); margin-top: 4px;">{sinceLine}</div>
        {#if displayMotto}
          <div class="font-instrument" style="font-style: italic; font-size: 13px; color: var(--k-ink-soft); margin-top: 6px;">{displayMotto}</div>
        {/if}
        {#if profile.verified}
          <div style="margin-top: 8px;">
            <span
              class="font-dmmono"
              style="display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; background: var(--k-teal); color: var(--k-paper); border: 1.5px solid var(--k-ink); border-radius: 999px; font-size: 10px; font-weight: 500; letter-spacing: 0.08em;"
            >✓ {$t['profile.verified']}</span>
          </div>
        {/if}
      </div>
    </div>

    {#if avatarState !== 'idle'}
      <PAvatarUploadPanel
        panelState={avatarState}
        percent={avatarPercent}
        errorKey={avatarErrorKey}
        onPickFile={validateAndUploadAvatar}
        onCancelUpload={cancelAvatarUpload}
        onRetry={retryAvatarUpload}
        onPickOther={pickOtherAvatar}
      />
    {/if}

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 18px; border-top: 1.5px dashed var(--k-rule); padding-top: 12px;">
      {#each [
        { n: profile.stats.posts, label: $t['profile.stats.posts'] },
        { n: profile.stats.listings, label: $t['profile.stats.listings'] },
        { n: profile.stats.events, label: $t['profile.stats.events'] },
        { n: profile.stats.danke, label: $t['profile.stats.danke'] },
      ] as s, i (s.label)}
        <div style="text-align: center; border-left: {i > 0 ? '1px dashed var(--k-rule)' : 'none'};">
          <div class="font-bricolage" style="font-size: 21px; font-weight: 800;">{s.n}</div>
          <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.1em;">{s.label}</div>
        </div>
      {/each}
    </div>

    <div style="margin-top: 16px;" data-tour="profil-hobbies">
      <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em; margin-bottom: 8px;">{$t['profile.interests']}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        {#each displayHobbies as h (h)}
          <PHobbyChip>{h}</PHobbyChip>
        {/each}
      </div>
    </div>

    <div style="margin-top: 16px; display: flex; gap: 8px;">
      <PBtn primary small disabled={banned || saveState === 'saving'} onclick={startEdit}>{$t['profile.action.edit']}</PBtn>
      <PBtn small href="/steckbrief" disabled={banned}>{$t['profile.action.steckbrief']}</PBtn>
    </div>
  {:else}
    <!-- ═══ Edit state ═══ -->
    <div style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px;">
      <PAvatar
        name={editName}
        image={displayImage}
        editable
        onOpenUpload={openAvatarPicker}
        showSavedBadge={avatarState === 'saved'}
      />
      <div style="flex: 1; min-width: 0;">
        <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 5px;">{$t['profile.edit.name.label']}</div>
        <input
          class="font-bricolage"
          type="text"
          bind:value={editName}
          oninput={() => (nameError = null)}
          onfocus={() => (nameFocused = true)}
          onblur={() => (nameFocused = false)}
          maxlength={30}
          style="width: 100%; box-sizing: border-box; padding: 10px 13px; background: var(--k-paper-soft); border: 1.5px solid {nameBorder}; border-radius: 8px; font-size: 14px; font-weight: 500; color: var(--k-ink); outline: none;"
        />
        {#if nameError}
          <div class="font-dmmono" style="font-size: 10px; color: var(--k-danger); margin-top: 4px;">✕ {nameError}</div>
        {:else}
          <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 4px;">{$t['profile.edit.name.hint']}</div>
        {/if}

        <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-top: 12px; margin-bottom: 5px;">{$t['profile.edit.motto.label']}</div>
        <input
          class="font-instrument"
          type="text"
          bind:value={editMotto}
          onfocus={() => (mottoFocused = true)}
          onblur={() => (mottoFocused = false)}
          maxlength={MOTTO_MAX_LEN}
          style="width: 100%; box-sizing: border-box; padding: 10px 13px; background: var(--k-paper-soft); border: 1.5px solid {mottoFocused ? 'var(--k-ink)' : 'var(--k-rule)'}; border-radius: 8px; font-size: 14px; font-style: italic; color: var(--k-ink); outline: none;"
        />
        <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 4px;">{$t['profile.edit.motto.hint']}</div>
      </div>
    </div>

    {#if avatarState !== 'idle'}
      <div style="margin-bottom: 18px;">
        <PAvatarUploadPanel
          panelState={avatarState}
          percent={avatarPercent}
          errorKey={avatarErrorKey}
          onPickFile={validateAndUploadAvatar}
          onCancelUpload={cancelAvatarUpload}
          onRetry={retryAvatarUpload}
          onPickOther={pickOtherAvatar}
        />
      </div>
    {/if}

    <div class="font-dmmono" style="font-size: 9.5px; letter-spacing: 0.14em; color: var(--k-ink-mute); margin-bottom: 8px;">{$t['profile.edit.hobbies.label']}</div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px;">
      {#each editHobbies as h (h)}
        <PHobbyChip removable newlyAdded={newlyAdded.includes(h)} onRemove={() => removeHobby(h)}>{h}</PHobbyChip>
      {/each}
      {#if editHobbies.length < HOBBY_MAX_COUNT}
        <input
          class="font-bricolage"
          type="text"
          bind:value={newHobby}
          onkeydown={handleHobbyKeydown}
          maxlength={HOBBY_MAX_LEN}
          placeholder={'+ ' + $t['profile.edit.hobbies.add']}
          style="padding: 5px 12px; border: 1.5px dashed var(--k-ink-mute); border-radius: 999px; font-size: 12.5px; color: var(--k-ink); background: transparent; outline: none; min-width: 150px;"
        />
      {/if}
    </div>

    <div class="font-dmmono" style="padding: 10px 13px; background: var(--k-paper-soft); border: 1px dashed var(--k-rule); border-radius: 8px; font-size: 10px; color: var(--k-ink-mute); line-height: 1.6; margin-bottom: 16px;">
      {$t['profile.edit.email.label']} · {profile.email}<br />{$t['profile.edit.email.note']}
    </div>

    {#if saveState === 'failed'}
      <div style="display: flex; gap: 11px; padding: 8px 11px; background: #f6e3e3; border: 1.5px solid var(--k-danger); border-radius: 8px; margin-bottom: 16px;">
        <span style="font-family: var(--k-font-mono); font-size: 11px; color: var(--k-danger); font-weight: 700; flex-shrink: 0;">✕</span>
        <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-soft); line-height: 1.55;">
          {saveError ?? $t['profile.save.failed']}
          <button
            type="button"
            onclick={handleSave}
            style="font-family: var(--k-font-mono); font-size: 9.5px; font-weight: 700; color: var(--k-danger); background: none; border: none; border-bottom: 1.5px solid var(--k-danger); padding: 0; cursor: pointer;"
          >{$t['profile.save.retry']}</button>
        </div>
      </div>
    {/if}

    <div style="display: flex; gap: 8px;">
      <PBtn primary onclick={handleSave}>{$t['profile.edit.save']}</PBtn>
      <PBtn onclick={cancelEdit}>{$t['profile.edit.cancel']}</PBtn>
    </div>
  {/if}
</PCard>
