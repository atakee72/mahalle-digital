<script lang="ts">
  // Two buttons instead of a password form on a read-only demo deployment (spec 2026-10-26).
  // Used by TWO islands (login, register) -> NO <style> block; classes live in global.css (.dd-*).
  import { t } from '../../lib/kiosk-i18n';
  import { startDemo } from '../../lib/demo/startDemo';
  import AuthBanner from '../auth/kiosk/primitives/AuthBanner.svelte';

  let { redirectParam = undefined }: { redirectParam?: string | null } = $props();

  let pending = $state<'member' | 'admin' | null>(null);
  let failed = $state(false);

  async function go(role: 'member' | 'admin') {
    if (pending) return;
    pending = role;
    failed = false;
    const redirect = redirectParam ?? new URLSearchParams(window.location.search).get('redirect');
    const ok = await startDemo(role, redirect);
    if (!ok) {
      pending = null;
      failed = true;
    }
  }
</script>

<div class="dd-wrap">
  <h2 class="font-bricolage dd-h">{$t['auth.demo.h']}</h2>
  <p class="font-bricolage dd-p">{$t['auth.demo.p']}</p>
  {#if failed}
    <AuthBanner kind="danger" title={$t['auth.demo.fail']} />
  {/if}
  <button type="button" class="dd-btn font-bricolage" disabled={pending !== null} onclick={() => go('member')}>{$t['lnd.demo.member']}</button>
  <button type="button" class="dd-btn dd-btn--admin font-bricolage" disabled={pending !== null} onclick={() => go('admin')}>{$t['lnd.demo.admin']}</button>
</div>
