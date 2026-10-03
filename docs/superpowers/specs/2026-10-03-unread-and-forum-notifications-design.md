# Unread dots + forum notifications — design (2026-10-03)

Decisions taken with the owner on 2026-10-02 (his answers to four questions), written down so the
two plans can argue from them. Both plans were prototyped on a throwaway branch first: every code
block in them ran, type-checked (tsc 16 / svelte-check 81), passed its tests and was seen in a
browser on the local production build against `mahalle-dev`.

## A. „New since your last visit" (plan `2026-10-03-unread-dots.md`)

- **Sections:** Forum, Kalender, Markt, Blog. Not News, not Kiez-Daten.
- **Dot rule (his choice):** a tab shows a dot when something was published in that section since
  the member last OPENED it. Opening the section is the visit: it clears the dot and the cards
  published since the PREVIOUS visit carry a „neu" chip during that visit (a reload inside 30 min
  keeps the same baseline). Stored on the account (`users.lastVisit.<section>: Date`), so it
  follows the member across devices.
- **Own content never counts** — no dot, no chip for the member's own posts/events/listings.
  Admins get dots and chips like everyone.
- **No stamp ⇒ nothing is new.** The first visit after the deploy only sets the baseline.
- **Where:** desktop pill tabs and the phone bottom tabs (Forum/Kal./Markt). Phones have no Blog
  tab — the account menu's „Beilage" row carries the blog dot there.
- **Not done:** a per-post read record (his rejected option), markers on the market lead card (it
  already wears „frisch im Kiez heute"), markers in the calendar month grid (agenda rows only).
- **Honest gap:** the blog's „new" reads the post's `pubDate` (day precision), not the deploy moment — a post deployed in the evening raises no dot for a member who opened the blog that morning (the bell notification covers it). A post held for review and approved after the member's next visit gets no dot
  and no chip (the rules read the creation time). Listings published from a draft are stamped
  `createdAt = now` on publish — until now a draft kept for over 21 days was hidden from the
  public feed the moment it was published (the freshness clock read the draft's creation date).

## B. Forum notifications (plan `2026-10-03-forum-notifications.md`)

- **One preference per member,** `users.forumNotify`: absent = **digest** (his default), `'each'`
  = every new public forum post at once, `'off'`.
- **Digest:** **daily**, rides the morning cron (`/api/news/fetch-daily`, 06:00 UTC), once per
  Berlin day (claim-by-insert in `forumDigests`, the afternoon GitHub run finds the day claimed),
  skipped when nothing is new. Window = since the previous digest (24 h on the first run, never
  more than 48 h). Per member: posts not their own and newer than their last forum visit (plan A's
  stamp) — a member who read the forum last night is not told about those posts again. One post →
  the row opens the post; several → „n neue Beiträge im Forum" opening `/forum`.
- **Every post:** sent from the three create routes when the post is public at once, and from
  the review action when a held post is approved (not on user reports, not with a warning label,
  not for a post older than 7 days — an edited old post must not re-announce). Idempotent per post
  (`meta.sourceId`), the author is never told.
- **Left out everywhere:** official announcements (they have their own notification), posts with a
  warning label, banned and anonymized accounts. Admins are recipients like everyone.
- **Transport:** bell row + web push (type `'forum'`), never e-mail.
- **Setting UI:** a three-way switch („täglich · jeden · aus") at the top of the notification
  panel, under its head — where notifications live and where the push toggle already is. Route
  `GET/POST /api/profile/forum-notify`.
