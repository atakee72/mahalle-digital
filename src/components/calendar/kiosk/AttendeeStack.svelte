<script lang="ts">
  // Avatar stack of users who said Going.
  //
  // Two render modes (backwards-compatible):
  //   1. `users` — real KioskAvatar cluster (name + Cloudinary image,
  //      initials fallback). Tight ~8px overlap, name on hover via the
  //      `title` attribute.
  //   2. `userIds` — colored-disc fallback (palette cycles per index,
  //      decorative only). Renders while real profiles are loading,
  //      or when no `users` prop is passed.

  import KioskAvatar from '../../forum/kiosk/KioskAvatar.svelte';

  type AttendeeUser = {
    id: string;
    name: string;
    handle?: string | null;
    image: string | null;
  };

  let {
    users,
    userIds = [],
    max = 6
  } = $props<{
    users?: AttendeeUser[];
    userIds?: string[];
    max?: number;
  }>();

  const hasRealAvatars = $derived(Array.isArray(users) && users.length > 0);

  const visibleUsers = $derived(users?.slice(0, max) ?? []);
  const visibleIds = $derived(userIds.slice(0, max));
  const overflow = $derived(
    hasRealAvatars
      ? Math.max(0, (users?.length ?? 0) - max)
      : Math.max(0, userIds.length - max)
  );

  const tones = [
    'bg-wine',
    'bg-ochre',
    'bg-teal',
    'bg-plum',
    'bg-moss',
    'bg-ink-soft'
  ] as const;
</script>

{#if hasRealAvatars}
  <div class="flex flex-wrap items-center">
    {#each visibleUsers as u, i (u.id)}
      <span title={u.handle ? `${u.name} · @${u.handle}` : u.name} class={i === 0 ? '' : '-ml-2'}>
        <KioskAvatar name={u.name} image={u.image} size="sm" />
      </span>
    {/each}
    {#if overflow > 0}
      <span
        class="w-7 h-7 rounded-full bg-paper border-[1.5px] border-ink inline-flex items-center justify-center font-dmmono text-[10px] font-semibold -ml-2"
      >
        +{overflow}
      </span>
    {/if}
  </div>
{:else}
  <div class="flex flex-wrap gap-1 items-center">
    {#each visibleIds as id, i (id)}
      <span
        class={`w-7 h-7 rounded-full border-[1.5px] border-ink ${tones[i % tones.length]}`}
        aria-hidden="true"
      ></span>
    {/each}
    {#if overflow > 0}
      <span
        class="w-7 h-7 rounded-full bg-paper border-[1.5px] border-ink inline-flex items-center justify-center font-dmmono text-[10px] font-semibold"
      >
        +{overflow}
      </span>
    {/if}
  </div>
{/if}
