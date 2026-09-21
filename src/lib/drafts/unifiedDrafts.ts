// One row shape for everything a member has left unfinished — forum drafts
// (`postDrafts`) and marketplace draft listings (`listings`, status 'draft').
// Dependency-pure: imported by the /entwuerfe page (server) AND its island.
import { draftResumeHref, type PostDraftDTO } from '../forum/postDrafts';

export type UnifiedDraft = {
  id: string;
  source: 'forum' | 'markt';
  /** kiosk-i18n key of the kind word (existing keys, nothing new to translate). */
  kindKey: string;
  title: string;
  updatedAt: string; // ISO
  thumb: string | null;
  resumeHref: string;
  deleteUrl: string;
};

const POST_KIND_KEY = { discussion: 'chip.discussion', announcement: 'chip.announcement', recommendation: 'chip.recommendation' } as const;
const LISTING_KIND_KEY: Record<string, string> = { sell: 'market.filter.kind.verkaufen', exchange: 'market.filter.kind.tausch', gift: 'market.filter.kind.verschenken' };

export function fromPostDraft(d: PostDraftDTO): UnifiedDraft {
  return {
    id: d.id,
    source: 'forum',
    kindKey: POST_KIND_KEY[d.kind],
    title: d.title.trim(),
    updatedAt: d.updatedAt,
    thumb: d.images[0]?.url ?? null,
    resumeHref: draftResumeHref(d.id),
    deleteUrl: `/api/posts/drafts/${d.id}`
  };
}

/** The fields of a `listings` document this page needs — typed loosely so the
 *  mapper never imports mongodb (an ObjectId only has to stringify). */
export type ListingDraftLike = {
  _id: { toString(): string } | string;
  title?: string;
  listingType?: string;
  images?: string[];
  updatedAt?: Date | string;
  createdAt?: Date | string;
};

const iso = (v: Date | string | undefined): string => (v ? new Date(v).toISOString() : new Date(0).toISOString());

export function fromListingDraft(l: ListingDraftLike): UnifiedDraft {
  const id = String(l._id);
  return {
    id,
    source: 'markt',
    kindKey: LISTING_KIND_KEY[l.listingType ?? 'sell'] ?? LISTING_KIND_KEY.sell,
    title: (l.title ?? '').trim(),
    updatedAt: iso(l.updatedAt ?? l.createdAt),
    thumb: l.images?.[0] ?? null,
    resumeHref: `/marketplace/create?draft=${id}`,
    deleteUrl: `/api/listings/delete/${id}`
  };
}

export function mergeDrafts(...lists: UnifiedDraft[][]): UnifiedDraft[] {
  return lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
