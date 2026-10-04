<script lang="ts">
  /**
   * Members list — Kiez-verification v1 admin surface (/admin/mitglieder).
   * Lists ALL non-tombstoned users so every member is reachable even if
   * they never posted; per-row toggle writes users.verified via
   * PATCH /api/admin/users/[id] (the flag's ONLY writer); per-row type selector
   * and, for organisations, a daily-limit field — both through the same PATCH.
   * Optimistic toggle with rollback + error toast. Client-side search
   * (name/@handle) — the list is capped at 1000 server-side, no pager v1.
   */
  import { onDestroy } from 'svelte';
  import { MEMBER_TYPES, MAX_DAILY_LIMIT, type MemberType } from '../../../lib/members/memberType';
  import { t, tStr, locale } from '../../../lib/kiosk-i18n';
  import { showError } from '../../../utils/toast';

  type AdminUserRow = {
    id: string;
    name: string;
    handle: string | null;
    createdAt: string | null;
    emailVerified: boolean;
    verified: boolean;
    role: 'user' | 'admin';
    memberType: MemberType;
    dailyLimit: number | null;
    newsletter: 'weekly' | 'off';
  };

  let users = $state<AdminUserRow[]>([]);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let query = $state('');
  // Rows with an in-flight PATCH — disables the row's toggle.
  let busy = $state<Set<string>>(new Set());

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.handle ?? '').toLowerCase().includes(q.replace(/^@/, ''))
    );
  });

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString($locale === 'de' ? 'de-DE' : 'en-GB', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  async function fetchUsers() {
    status = 'loading';
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = await res.json();
      users = Array.isArray(data.users) ? data.users : [];
      status = 'ready';
    } catch {
      status = 'error';
    }
  }

  type RowPatch = { verified?: boolean; memberType?: MemberType; dailyLimit?: number | null; newsletter?: 'weekly' | 'off' };

  // „✓ gespeichert" beside the controls for two seconds after a successful save.
  let savedRow = $state<string | null>(null);
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  function flashSaved(id: string) {
    savedRow = id;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { savedRow = null; }, 2000);
  }
  onDestroy(() => clearTimeout(savedTimer));

  // Optimistic write with rollback. The server's echo is the truth afterwards
  // (e.g. leaving „organisation" clears the limit server-side).
  async function patchRow(row: AdminUserRow, patch: RowPatch, optimistic: Partial<AdminUserRow>) {
    if (busy.has(row.id)) return;
    busy = new Set(busy).add(row.id);
    const prev = { ...row };
    users = users.map((u) => (u.id === row.id ? { ...u, ...optimistic } : u));
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error(`patch failed (${res.status})`);
      const j = await res.json();
      users = users.map((u) => (u.id === row.id
        ? { ...u, verified: j.verified === true, memberType: j.memberType, dailyLimit: j.dailyLimit ?? null, newsletter: j.newsletter === 'off' ? 'off' : 'weekly' }
        : u));
      // The type selector and the limit field save without a button — say so.
      // (The verify button already changes its own label; no mark for it.)
      if (patch.memberType !== undefined || patch.dailyLimit !== undefined) flashSaved(row.id);
    } catch {
      users = users.map((u) => (u.id === row.id ? prev : u));
      showError($t['admin.users.toast.fail']);
      // Show the server's truth, not the admin's stale view of the row.
      void fetchUsers();
    } finally {
      const s = new Set(busy);
      s.delete(row.id);
      busy = s;
    }
  }

  function toggleVerified(row: AdminUserRow) {
    const next = !row.verified;
    return patchRow(row, { verified: next }, { verified: next });
  }

  // Kiez-Brief on/off for this member (test accounts, addresses that bounce).
  function toggleBrief(row: AdminUserRow) {
    const next = row.newsletter === 'off' ? 'weekly' : 'off';
    return patchRow(row, { newsletter: next }, { newsletter: next });
  }

  function setType(row: AdminUserRow, next: MemberType) {
    if (next === row.memberType) return;
    return patchRow(row, { memberType: next }, {
      memberType: next,
      dailyLimit: next === 'organisation' ? row.dailyLimit : null,
    });
  }

  function setLimit(row: AdminUserRow, el: HTMLInputElement) {
    // A number input holding garbage („1e", „-") reports value '' — that is
    // bad input, NOT an emptied field: never clear a stored limit for it.
    if (el.validity.badInput) {
      showError($t['admin.users.toast.limit']);
      el.value = String(row.dailyLimit ?? '');
      return;
    }
    const text = el.value.trim();
    if (text === '') {
      if (row.dailyLimit === null) return;
      return patchRow(row, { dailyLimit: null }, { dailyLimit: null });
    }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAILY_LIMIT) {
      showError($t['admin.users.toast.limit']);
      // Put the stored value back by hand: Svelte skips the DOM write when the
      // bound value did not change, so a re-render would leave the bad text.
      el.value = String(row.dailyLimit ?? '');
      return;
    }
    if (n === row.dailyLimit) return;
    return patchRow(row, { dailyLimit: n }, { dailyLimit: n });
  }

  $effect(() => {
    fetchUsers();
  });
</script>

<div style="max-width: 880px; margin: 0 auto; padding: 26px 18px 60px;">
  <!-- Title block -->
  <div style="margin-bottom: 18px;">
    <div class="font-dmmono" style="font-size: 10px; color: var(--k-accent); letter-spacing: 0.14em;">
      {$t['admin.users.kicker']}
    </div>
    <h1 class="font-bricolage" style="font-size: 28px; font-weight: 800; letter-spacing: -0.03em; margin: 4px 0 2px;">
      {$t['admin.users.heading']}
    </h1>
    <p class="font-instrument" style="font-style: italic; font-size: 14px; color: var(--k-ink-soft); margin: 0;">
      {$t['admin.users.sub']}
    </p>
  </div>

  {#if status === 'loading'}
    <div class="font-dmmono" style="font-size: 12px; color: var(--k-ink-mute); padding: 40px 0; text-align: center;">
      {$t['admin.users.loading']}
    </div>
  {:else if status === 'error'}
    <div style="text-align: center; padding: 40px 0;">
      <p class="font-bricolage" style="font-size: 14px; color: var(--k-danger); margin: 0 0 12px;">{$t['admin.users.error']}</p>
      <button
        type="button"
        class="font-dmmono"
        style="border: 1.5px solid var(--k-ink); border-radius: 999px; padding: 7px 16px; font-size: 12px; font-weight: 700; background: var(--k-paper-warm); cursor: pointer;"
        onclick={fetchUsers}
      >{$t['admin.users.retry']}</button>
    </div>
  {:else}
    <!-- Search + count row -->
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px;">
      <input
        type="search"
        class="font-bricolage"
        style="
          flex: 1; min-width: 220px; background: var(--k-paper-warm);
          border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-md);
          padding: 8px 12px; font-size: 13px; color: var(--k-ink);
        "
        placeholder={$t['admin.users.search']}
        bind:value={query}
      />
      <span class="font-dmmono" style="font-size: 11px; color: var(--k-ink-mute); letter-spacing: 0.08em;">
        {tStr($t['admin.users.count'], { n: filtered.length })}
      </span>
    </div>

    {#if filtered.length === 0}
      <div class="font-instrument" style="font-style: italic; font-size: 14px; color: var(--k-ink-mute); padding: 30px 0; text-align: center;">
        {$t['admin.users.empty']}
      </div>
    {:else}
      <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px;">
        {#each filtered as row (row.id)}
          <li
            style="
              background: var(--k-paper-warm); border: 1.5px solid var(--k-ink);
              border-radius: var(--k-radius-md); padding: 12px 16px;
              display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
              {row.verified ? 'box-shadow: 2px 2px 0 var(--k-accent);' : ''}
            "
          >
            <div style="flex: 1; min-width: 180px;">
              <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
                <span class="font-bricolage" style="font-size: 15px; font-weight: 700;">{row.name || '—'}</span>
                {#if row.handle}
                  <span class="font-dmmono" style="font-size: 11px; color: var(--k-ink-mute);">@{row.handle}</span>
                {/if}
                {#if row.role === 'admin'}
                  <span class="font-dmmono" style="font-size: 9px; font-weight: 600; background: var(--k-accent); color: var(--k-paper); padding: 1px 6px; border-radius: 999px; letter-spacing: 0.08em;">{$t['admin.users.adminchip']}</span>
                {/if}
              </div>
              <div class="font-dmmono" style="font-size: 10px; color: var(--k-ink-mute); margin-top: 3px; letter-spacing: 0.05em;">
                {tStr($t['admin.users.since'], { d: fmtDate(row.createdAt) })}
                &nbsp;·&nbsp;
                {row.emailVerified ? $t['admin.users.emailok'] : $t['admin.users.emailno']}
              </div>
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px;">
              <label class="font-dmmono" style="display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute);">
                {$t['admin.users.type.label']}
                <select
                  class="font-bricolage"
                  data-admin-type
                  style="border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 12px; padding: 5px 6px; min-height: 32px;"
                  disabled={busy.has(row.id)}
                  value={row.memberType}
                  onchange={(e) => setType(row, (e.currentTarget as HTMLSelectElement).value as MemberType)}
                >
                  {#each MEMBER_TYPES as opt (opt)}
                    <option value={opt}>{$t[`member.type.${opt}`]}</option>
                  {/each}
                </select>
              </label>
              {#if row.memberType === 'organisation'}
                <label class="font-dmmono" style="display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: 0.1em; color: var(--k-ink-mute);">
                  {$t['admin.users.limit.label']}
                  <input
                    type="number"
                    inputmode="numeric"
                    min="1"
                    max={MAX_DAILY_LIMIT}
                    step="1"
                    data-admin-limit
                    class="font-dmmono"
                    style="width: 64px; border: 1.5px solid var(--k-ink); border-radius: var(--k-radius-sm); background: var(--k-paper); color: var(--k-ink); font-size: 12px; padding: 5px 6px; min-height: 32px;"
                    placeholder="5"
                    title={$t['admin.users.limit.hint']}
                    disabled={busy.has(row.id)}
                    value={row.dailyLimit ?? ''}
                    onchange={(e) => setLimit(row, e.currentTarget as HTMLInputElement)}
                  />
                </label>
              {/if}
              {#if savedRow === row.id}
                <span
                  class="font-dmmono"
                  role="status"
                  data-admin-saved
                  style="font-size: 10px; font-weight: 600; color: var(--k-moss); letter-spacing: 0.06em;"
                >{$t['admin.users.saved']}</span>
              {/if}
              <button
                type="button"
                class="font-dmmono"
                data-admin-brief={row.newsletter}
                title={$t['admin.users.brief.title']}
                aria-pressed={row.newsletter !== 'off'}
                style="
                  border: 1.5px {row.newsletter === 'off' ? 'dashed' : 'solid'} var(--k-ink); border-radius: 999px;
                  padding: 6px 12px; font-size: 11px; font-weight: 700;
                  cursor: pointer; min-height: 32px; background: var(--k-paper);
                  color: {row.newsletter === 'off' ? 'var(--k-ink-mute)' : 'var(--k-ink)'};
                  {busy.has(row.id) ? 'opacity: 0.5; cursor: wait;' : ''}
                "
                disabled={busy.has(row.id)}
                onclick={() => toggleBrief(row)}
              >
                {row.newsletter === 'off' ? $t['admin.users.brief.off'] : $t['admin.users.brief.on']}
              </button>
              {#if row.verified}
                <span class="font-dmmono" style="font-size: 10px; font-weight: 600; background: var(--k-moss); color: var(--k-paper); padding: 2px 8px; border-radius: var(--k-radius-sm); border: 1px solid var(--k-ink); letter-spacing: 0.08em;">
                  {$t['admin.users.verifiedchip']}
                </span>
              {/if}
              <button
                type="button"
                class="font-dmmono"
                style="
                  border: 1.5px solid var(--k-ink); border-radius: 999px;
                  padding: 6px 14px; font-size: 11px; font-weight: 700;
                  cursor: pointer; min-height: 32px;
                  {row.verified
                    ? 'background: var(--k-paper); color: var(--k-ink);'
                    : 'background: var(--k-ink); color: var(--k-paper);'}
                  {busy.has(row.id) ? 'opacity: 0.5; cursor: wait;' : ''}
                "
                disabled={busy.has(row.id)}
                onclick={() => toggleVerified(row)}
              >
                {row.verified ? $t['admin.users.action.unverify'] : $t['admin.users.action.verify']}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
