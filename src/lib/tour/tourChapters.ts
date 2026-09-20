import type { ChapterKey } from './tourStore';

export interface TourStop {
  anchor: string;
  titleKey: string;
  bodyKey: string;
  bodyMobileKey?: string;               // used once (Kalender S2)
  link?: {                              // used once (Forum S7 template)
    labelKey: string;
    hrefBase: string;                   // e.g. '/topics/create'
    prefillTitleKey: string;
    prefillBodyKey: string;
    prefillTags: string;                // e.g. 'neu-hier'
  };
}
export interface TourChapter {
  key: ChapterKey; page: string; kickerKey: string;
  stops: TourStop[]; endNoteKey: string;
  nextChapterKey?: string; nextChapterHref?: string;   // optional (final chapter has neither)
  final?: boolean;                                     // Profil only
}

// All 7 chapters live (copy source: design/handoffs/TOUR_CC_ANSWERS.md +
// TOUR_DEPTH_ANSWERS.md). Safe anchors only: chrome + top-level controls,
// never the n-th card (handoff, non-negotiable). Anchors must be
// unconditional (always in the DOM) — silent skip is defect insurance,
// not a design tool (TOUR_DEPTH_ANSWERS §3).
export const CHAPTERS_BY_PAGE: Record<string, TourChapter> = {
  forum: {
    key: 'forum',
    page: 'forum',
    kickerKey: 'tour.forum.kicker',
    stops: [
      { anchor: '[data-tour="forum-filter-discussion"]',     titleKey: 'tour.forum.s1.title', bodyKey: 'tour.forum.s1.body' },
      { anchor: '[data-tour="forum-filter-announcement"]',   titleKey: 'tour.forum.s2.title', bodyKey: 'tour.forum.s2.body' },
      { anchor: '[data-tour="forum-filter-recommendation"]', titleKey: 'tour.forum.s3.title', bodyKey: 'tour.forum.s3.body' },
      { anchor: '[data-tour="forum-filter-saved"]',          titleKey: 'tour.forum.s4.title', bodyKey: 'tour.forum.s4.body' },
      { anchor: '[data-tour="forum-filter-mine"]',           titleKey: 'tour.forum.s5.title', bodyKey: 'tour.forum.s5.body' },
      { anchor: '[data-tour="forum-tag"]',                   titleKey: 'tour.forum.s6.title', bodyKey: 'tour.forum.s6.body', bodyMobileKey: 'tour.forum.s6.bodyMobile' },
      { anchor: '[data-tour="forum-new-topic"]',             titleKey: 'tour.forum.s7.title', bodyKey: 'tour.forum.s7.body',
        link: { labelKey: 'tour.template.open', hrefBase: '/topics/create', prefillTitleKey: 'tour.template.title', prefillBodyKey: 'tour.template.body', prefillTags: 'neu-hier' } },
    ],
    endNoteKey: 'tour.forum.end.note',
    nextChapterKey: 'tour.forum.end.next',
    nextChapterHref: '/calendar',
  },
  calendar: {
    key: 'kalender',
    page: 'calendar',
    kickerKey: 'tour.cal.kicker',
    stops: [
      { anchor: '[data-tour="cal-view"]',       titleKey: 'tour.cal.s1.title', bodyKey: 'tour.cal.s1.body' },
      { anchor: '[data-tour="cal-month-nav"]',  titleKey: 'tour.cal.s2.title', bodyKey: 'tour.cal.s2.body' },
      { anchor: '[data-tour="cal-grid"]',       titleKey: 'tour.cal.s3.title', bodyKey: 'tour.cal.s3.body', bodyMobileKey: 'tour.cal.s3.bodyMobile' },
      { anchor: '[data-tour="cal-rsvp"]',       titleKey: 'tour.cal.s4.title', bodyKey: 'tour.cal.s4.body' },
      { anchor: '[data-tour="cal-my-filters"]', titleKey: 'tour.cal.s5.title', bodyKey: 'tour.cal.s5.body' },
      { anchor: '[data-tour="cal-categories"]', titleKey: 'tour.cal.s6.title', bodyKey: 'tour.cal.s6.body' },
    ],
    endNoteKey: 'tour.cal.end.note',
    nextChapterKey: 'tour.cal.end.next',
    nextChapterHref: '/marketplace',
  },
  marketplace: {
    key: 'markt',
    page: 'marketplace',
    kickerKey: 'tour.markt.kicker',
    stops: [
      { anchor: '[data-tour="markt-kinds"]',      titleKey: 'tour.markt.s1.title', bodyKey: 'tour.markt.s1.body' },
      { anchor: '[data-tour="markt-categories"]', titleKey: 'tour.markt.s2.title', bodyKey: 'tour.markt.s2.body' },
      { anchor: '[data-tour="markt-create"]',     titleKey: 'tour.markt.s3.title', bodyKey: 'tour.markt.s3.body' },
      { anchor: '[data-tour="markt-grid"]',       titleKey: 'tour.markt.s4.title', bodyKey: 'tour.markt.s4.body' },
      { anchor: '[data-tour="markt-mine"]',       titleKey: 'tour.markt.s5.title', bodyKey: 'tour.markt.s5.body' },
    ],
    endNoteKey: 'tour.markt.end.note',
    nextChapterKey: 'tour.markt.end.next',
    nextChapterHref: '/newsboard',
  },
  newsboard: {
    key: 'kurier',
    page: 'newsboard',
    kickerKey: 'tour.kurier.kicker',
    stops: [
      { anchor: '[data-tour="kurier-masthead"]', titleKey: 'tour.kurier.s1.title', bodyKey: 'tour.kurier.s1.body' },
      { anchor: '[data-tour="kurier-sections"]', titleKey: 'tour.kurier.s2.title', bodyKey: 'tour.kurier.s2.body' },
      { anchor: '[data-tour="kurier-saved"]',    titleKey: 'tour.kurier.s3.title', bodyKey: 'tour.kurier.s3.body' },
      // Fade-stop anchor deviates from TOUR_CC_ANSWERS (Ungelesen filter is
      // shipped disabled — Phase-1 placeholder); rings the filter row instead,
      // copy softened accordingly. User-approved 2026-08-10.
      { anchor: '[data-tour="kurier-fade"]',     titleKey: 'tour.kurier.s4.title', bodyKey: 'tour.kurier.s4.body' },
      { anchor: '[data-tour="kurier-submit"]',   titleKey: 'tour.kurier.s5.title', bodyKey: 'tour.kurier.s5.body' },
    ],
    endNoteKey: 'tour.kurier.end.note',
    nextChapterKey: 'tour.kurier.end.next',
    nextChapterHref: '/schillerkiez',
  },
  schillerkiez: {
    key: 'kiezdaten',
    page: 'schillerkiez',
    kickerKey: 'tour.kiez.kicker',
    stops: [
      { anchor: '[data-tour="kiez-plr"]',   titleKey: 'tour.kiez.s1.title', bodyKey: 'tour.kiez.s1.body' },
      { anchor: '[data-tour="kiez-kanal"]', titleKey: 'tour.kiez.s2.title', bodyKey: 'tour.kiez.s2.body' },
      { anchor: '[data-tour="kiez-druck"]', titleKey: 'tour.kiez.s3.title', bodyKey: 'tour.kiez.s3.body' },
    ],
    endNoteKey: 'tour.kiez.end.note',
    nextChapterKey: 'tour.kiez.end.next',
    nextChapterHref: '/blog',
  },
  blog: {
    key: 'blog',
    page: 'blog',
    kickerKey: 'tour.blog.kicker',
    stops: [
      { anchor: '[data-tour="blog-rubriken"]', titleKey: 'tour.blog.s1.title', bodyKey: 'tour.blog.s1.body' },
      { anchor: '[data-tour="blog-archiv"]',   titleKey: 'tour.blog.s2.title', bodyKey: 'tour.blog.s2.body' },
      { anchor: '[data-tour="blog-aufruf"]',   titleKey: 'tour.blog.s3.title', bodyKey: 'tour.blog.s3.body' },
    ],
    endNoteKey: 'tour.blog.end.note',
    nextChapterKey: 'tour.blog.end.next',
    nextChapterHref: '/profile',
  },
  profile: {
    key: 'profil',
    page: 'profile',
    kickerKey: 'tour.profil.kicker',
    stops: [
      { anchor: '[data-tour="profil-hobbies"]', titleKey: 'tour.profil.s1.title', bodyKey: 'tour.profil.s1.body' },
      { anchor: '[data-tour="profil-archiv"]',  titleKey: 'tour.profil.s2.title', bodyKey: 'tour.profil.s2.body' },
      { anchor: '[data-tour="profil-chronik"]', titleKey: 'tour.profil.s3.title', bodyKey: 'tour.profil.s3.body' },
    ],
    endNoteKey: 'tour.profil.end.note',
    final: true,
  },
};
