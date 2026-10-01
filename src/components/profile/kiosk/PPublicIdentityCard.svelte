<script lang="ts">
  // Public "Nachbarn" identity card — slim read-only sibling of
  // PIdentityCard: avatar (never editable), name, handle+seit line,
  // verified pill, stats grid (desktop only — mobile public hides stats
  // per the JSX compact card), hobby chips. NO edit button, NO ÄNDERN
  // avatar chip, NO email box — visiting a neighbor's profile never
  // exposes a write surface.
  // Design source: kiosk-profile.jsx (PIdentityCard, own=false branch) +
  // kiosk-profile-public.jsx (PublicProfileMobile's compact identity card
  // — same anatomy minus the stats grid).

  import { t, tStr } from '../../../lib/kiosk-i18n';
  import type { PublicProfile } from '../../../lib/profile/profileShared';
  import PCard from './atoms/PCard.svelte';
  import PAvatar from './atoms/PAvatar.svelte';
  import PHobbyChip from './atoms/PHobbyChip.svelte';
  import MemberTypeTag from '../../forum/kiosk/MemberTypeTag.svelte';

  let { profile }: { profile: PublicProfile } = $props();

  const sinceLine = $derived(`@${profile.handle} · ${tStr($t['profile.since'], { y: profile.memberSince })}`);
</script>

<PCard>
  <div style="display: flex; gap: 16px; align-items: flex-start;">
    <!-- Desktop avatar (92px, per PIdentityCard's own default size) -->
    <div class="hidden lg:block">
      <PAvatar name={profile.name} image={profile.image} editable={false} size={92} />
    </div>
    <!-- Mobile avatar (68px, per PublicProfileMobile's compact card) -->
    <div class="lg:hidden">
      <PAvatar name={profile.name} image={profile.image} editable={false} size={68} />
    </div>
    <div style="min-width: 0;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <h2
          class="font-bricolage"
          style="font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0; line-height: 1.05;"
        >{profile.name}</h2>
        <MemberTypeTag type={profile.memberType} />
      </div>
      <div class="font-dmmono" style="font-size: 11px; color: var(--k-ink-mute); margin-top: 4px;">{sinceLine}</div>
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

  <!-- Stats grid — desktop only. PublicProfileMobile's compact identity card
       shows no stats at all (see kiosk-profile-public.jsx). -->
  <div
    class="hidden lg:grid"
    style="grid-template-columns: repeat(4, 1fr); margin-top: 18px; border-top: 1.5px dashed var(--k-rule); padding-top: 12px;"
  >
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

  {#if profile.hobbies.length > 0}
    <div style="margin-top: 16px;">
      <div class="font-dmmono" style="font-size: 9.5px; color: var(--k-ink-mute); letter-spacing: 0.14em; margin-bottom: 8px;">{$t['profile.interests']}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        {#each profile.hobbies as h (h)}
          <PHobbyChip>{h}</PHobbyChip>
        {/each}
      </div>
    </div>
  {/if}
</PCard>
