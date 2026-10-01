/**
 * Compose draft store — localStorage-backed Svelte writable.
 *
 * Single slot per kind (only `topic` in 5b; announcements / recommendations
 * gain their own slots when their compose flows ship). Recovers the
 * in-flight compose if the user refreshes or accidentally closes the tab.
 * Cleared on successful submit.
 *
 * Why a store and not a rune: same reason as kiosk-i18n.ts — the compose
 * page and the navbar's "discard draft" affordance are independent
 * islands that need to share state. A `$state` rune is component-scoped.
 *
 * Persistence: `localStorage`. SSR-safe — readInitial() returns null when
 * `localStorage` is undefined (server) so SSR never crashes and the
 * compose form starts empty on first paint, then hydrates the draft (if
 * any) when the client mounts.
 *
 * Auto-save debounce lives in the consumer (ComposeForm), not here, so
 * the store stays a thin persistence layer.
 */

import { writable } from 'svelte/store';

type DraftKind = 'topic';

export type DraftValues = {
  title: string;
  body: string;
  kind: 'discussion' | 'recommendation' | 'announcement';
  tags: string[];
  // Image previews are local object URLs — not persisted across reloads.
  // After reload the user re-picks files; the upload flow happens on
  // submit anyway, so this matches the lazy-upload model.
};

const STORAGE_KEY_PREFIX = 'kiosk-draft';

function storageKey(kind: DraftKind): string {
  return `${STORAGE_KEY_PREFIX}:${kind}`;
}

function readInitial(kind: DraftKind): DraftValues | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.title === 'string' &&
      typeof parsed.body === 'string' &&
      typeof parsed.kind === 'string' &&
      Array.isArray(parsed.tags)
    ) {
      return parsed as DraftValues;
    }
    return null;
  } catch {
    return null;
  }
}

function createDraftStore(kind: DraftKind = 'topic') {
  const store = writable<DraftValues | null>(readInitial(kind));

  function setDraft(values: DraftValues) {
    store.set(values);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageKey(kind), JSON.stringify(values));
      } catch {
        // Quota / privacy-mode — silently skip; draft will live in memory only.
      }
    }
  }

  function clearDraft() {
    store.set(null);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(storageKey(kind));
      } catch {
        /* ignore */
      }
    }
  }

  return { subscribe: store.subscribe, setDraft, clearDraft };
}

export const topicDraft = createDraftStore('topic');
