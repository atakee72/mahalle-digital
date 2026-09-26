<script lang="ts">
  import { optimizeCloudinary } from '../../../utils/cloudinary';
  import { initialsOf } from '../../../lib/initials';

  // Avatar with two render modes:
  //   1. Cloudinary photo when `image` is provided (auto WebP/AVIF via optimizeCloudinary)
  //   2. Deterministic-color initials fallback — same name always gets the same slot,
  //      so a given user is recognisable across the app even without a photo.
  //
  // Palette is the canvas-defined 5-slot set: wine · teal · ochre · moss · plum.

  let {
    name,
    image = null,
    size = 'md',
    slot: slotOverride,
    class: extraClass = ''
  } = $props<{
    name: string;
    image?: string | null;
    size?: 'sm' | 'md' | 'lg';
    /** Force a specific palette slot. Useful for canvas-fidelity examples
     *  ("Lena K." in the canvas is wine) or branded users (Mahalle-Team). */
    slot?: 'wine' | 'teal' | 'ochre' | 'moss' | 'plum';
    class?: string;
  }>();

  // Canvas palette. Order is part of the contract — don't reshuffle, or every
  // existing user's color silently changes.
  const palette = ['wine', 'teal', 'ochre', 'moss', 'plum'] as const;

  // Bg + readable text color per slot (ochre is light; ink reads better on it).
  const slotClass: Record<(typeof palette)[number], string> = {
    wine:  'bg-wine text-paper',
    teal:  'bg-teal text-paper',
    ochre: 'bg-ochre text-ink',
    moss:  'bg-moss text-paper',
    plum:  'bg-plum text-paper'
  };

  // Stable hash → palette index. djb2-ish; good enough for 5 buckets.
  function colorIndex(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % palette.length;
  }

  const trimmed = $derived(name.trim());
  const initials = $derived(initialsOf(name));
  // Explicit override wins; otherwise hash-derive from name.
  const slot = $derived(slotOverride ?? palette[colorIndex(trimmed || 'anon')]);
  const tone = $derived(slotClass[slot]);

  const sizeClass = $derived({
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base'
  }[size]);

  // optimizeCloudinary returns '' for non-Cloudinary URLs, so we fall through
  // to the initials slot only when there's nothing usable.
  const optimized = $derived(image ? optimizeCloudinary(image) : '');
  const showImage = $derived(!!optimized);
</script>

<div class={`relative inline-block ${extraClass}`}>
  {#if showImage}
    <img
      src={optimized}
      alt={name}
      class={`rounded-full object-cover border-2 border-ink ${sizeClass}`}
      loading="lazy"
    />
  {:else}
    <div
      class={`${sizeClass} ${tone} rounded-full flex items-center justify-center font-bricolage font-bold border-2 border-ink leading-none`}
    >
      {initials}
    </div>
  {/if}

</div>
