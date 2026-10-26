/**
 * Seed the DEMO database (demo.mahalle.digital) with fictional accounts and content.
 *   MONGODB_URI="<uri ending in /mahalle-dev-demo>" pnpm tsx scripts/seed-demo-db.ts [--write] [--copy-kiez-from <uri>]
 *
 * Content status: fictional, reviewed by the owner before commit: pending.
 * Every person, text and number below is invented; the only real names are public
 * places (Herrfurthplatz, Tempelhofer Feld).
 *
 * SAFETY INTERLOCK: refuses to run unless the database name contains BOTH "dev" and
 * "demo". Dry-run by default (prints collection -> count, writes nothing); `--write`
 * drops and rewrites the content collections named in DROP below. No demo account
 * carries a password (`password: null`), so there is no bcrypt here and no secret.
 *
 * `news` is never touched. `--copy-kiez-from <uri>` copies the five public
 * `schillerkiez_*` statistics collections from the SOURCE (read-only, its name is
 * never printed) into the target.
 *
 * Dates are relative to the run (daysAgo/daysAhead), so the nightly reseed keeps the
 * demo current. Field shapes mirror what the create routes write (see the comments).
 */
import 'dotenv/config';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');
const copyIdx = process.argv.indexOf('--copy-kiez-from');
const KIEZ_SOURCE = copyIdx >= 0 ? process.argv[copyIdx + 1] : undefined;

const KIEZ_COLLECTIONS = [
  'schillerkiez_demographics',
  'schillerkiez_social',
  'schillerkiez_reference',
  'schillerkiez_air_log',
  'schillerkiez_air_daily',
];

// Spec §6.3 — dropped on every run, then re-seeded (or left empty).
const DROP = [
  'users', 'topics', 'announcements', 'recommendations', 'comments', 'events', 'listings',
  'savedPosts', 'savedNews', 'notifications', 'flaggedContent', 'listingAuditTrail', 'postDrafts',
  'rateLimits', 'passwordResetTokens', 'emailVerifyTokens', 'emailChangeTokens',
  'accountDeletionTokens', 'pushSubscriptions', 'listingContacts', 'landingCache', 'chronikCache',
  'kiezKontextCache', 'translationCache', 'forumDigests', 'kiezBriefIssues',
];

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

// ---- Europe/Berlin day bounds (all-day events are Berlin days, root CLAUDE.md) ----
const berlinParts = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
};
function berlinOffsetMs(at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(f.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000;
}
function berlinWall(y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi, s, ms);
  let t = wall - berlinOffsetMs(new Date(wall));
  t = wall - berlinOffsetMs(new Date(t));
  return new Date(t);
}
/** [start, end] of the Berlin day `n` days from today (negative = past). */
function berlinDay(n: number): { start: Date; end: Date } {
  const { y, m, d } = berlinParts(new Date(Date.now() + n * DAY));
  return { start: berlinWall(y, m, d, 0, 0, 0, 0), end: berlinWall(y, m, d, 23, 59, 59, 999) };
}
/** A Berlin wall-clock time on the day `n` days from today. */
function berlinAt(n: number, h: number, mi = 0): Date {
  const { y, m, d } = berlinParts(new Date(Date.now() + n * DAY));
  return berlinWall(y, m, d, h, mi);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required (set in .env or shell env).');
    process.exit(1);
  }
  const dbName = new URL(uri).pathname.slice(1);
  if (!/dev/i.test(dbName) || !/demo/i.test(dbName)) {
    console.error('Refusing: database name must contain both "dev" and "demo"');
    process.exit(1);
  }

  const now = new Date();

  // ---------------------------------------------------------------- users
  const ids = Object.fromEntries(
    ['member', 'admin', 'leyla', 'tobias', 'nour', 'garten', 'fincan', 'marek'].map((k) => [k, new ObjectId()]),
  ) as Record<string, ObjectId>;
  const S = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, String(v)])) as Record<string, string>;

  const baseUser = {
    password: null as null, emailVerified: true, image: '', roleBadge: 'resident', hobbies: [] as string[],
    handleChosen: true, updatedAt: now.toISOString(),
  };
  const users: Record<string, unknown>[] = [
    { _id: ids.member, name: 'Demo-Mitglied', handle: 'demo_member', email: 'demo-mitglied@mahalle-dev.test', demo: true, verified: true, newsletter: 'off', forumNotify: 'off', createdAt: daysAgo(80).toISOString(), ...baseUser },
    { _id: ids.admin, name: 'Demo-Admin', handle: 'demo_admin', email: 'demo-admin@mahalle-dev.test', demo: true, role: 'admin', verified: true, newsletter: 'off', forumNotify: 'off', createdAt: daysAgo(90).toISOString(), ...baseUser },
    { _id: ids.leyla, name: 'Leyla Demirkaya', handle: 'leyla_d', email: 'leyla.demo@mahalle-dev.test', verified: true, createdAt: daysAgo(70).toISOString(), ...baseUser },
    { _id: ids.tobias, name: 'Tobias Wendt', handle: 'tobias_w', email: 'tobias.demo@mahalle-dev.test', createdAt: daysAgo(55).toISOString(), ...baseUser },
    { _id: ids.nour, name: 'Nour Haddad', handle: 'nour_h', email: 'nour.demo@mahalle-dev.test', createdAt: daysAgo(40).toISOString(), ...baseUser },
    { _id: ids.garten, name: 'Kiezgarten Schillerpromenade e.V.', handle: 'kiezgarten', email: 'kiezgarten.demo@mahalle-dev.test', memberType: 'organisation', createdAt: daysAgo(35).toISOString(), ...baseUser },
    { _id: ids.fincan, name: 'Café Fincan', handle: 'cafe_fincan', email: 'fincan.demo@mahalle-dev.test', memberType: 'business', createdAt: daysAgo(25).toISOString(), ...baseUser },
    { _id: ids.marek, name: 'Marek Nowak', handle: 'marek_n', email: 'marek.demo@mahalle-dev.test', createdAt: daysAgo(12).toISOString(), ...baseUser },
  ];

  // ---------------------------------------------------------------- posts (topics / announcements / recommendations)
  const post = (author: string, title: string, body: string, tags: string[], ageDays: number, extra: Record<string, unknown> = {}) => {
    const created = daysAgo(ageDays);
    return {
      _id: new ObjectId(), title, body, author, tags, images: [], mentions: [] as unknown[],
      comments: [] as ObjectId[], views: 20 + Math.floor(Math.random() * 120), likes: 0, likedBy: [] as string[],
      date: created.getTime(), moderationStatus: 'approved', createdAt: created, updatedAt: created,
      ...extra,
    };
  };
  const liked = (...who: string[]) => ({ likedBy: who, likes: who.length });

  const topics = [
    post(S.leyla, 'Wer hat Lust auf einen Hofflohmarkt im Mai?', 'Im letzten Jahr war in der Schillerpromenade so viel los, dass ich mich frage, ob wir einen gemeinsamen Hofflohmarkt organisieren können. Jeder stellt vor seiner Tür auf, wir hängen eine Karte aus. Wer wäre dabei?', ['hofflohmarkt', 'nachbarschaft'], 1, liked(S.tobias, S.nour, S.garten, S.member)),
    post(S.tobias, 'Fahrradwerkstatt in der Nähe?', 'Mein Hinterrad eiert und die Bremse quietscht. Kennt jemand eine Werkstatt, die auch kurzfristig und ohne Termin schaut? Am liebsten Selbsthilfe-Werkstatt, damit ich es lerne.', ['fahrrad', 'frage'], 2, liked(S.leyla)),
    post(S.nour, 'Laterne an der Ecke Herrfurthstraße ist seit Wochen kaputt', 'Der Weg zum Herrfurthplatz ist abends ziemlich dunkel. Hat jemand schon beim Bezirksamt gemeldet? Ich würde sonst einen Mängelmelder-Eintrag machen und hier die Nummer posten.', ['sicherheit', 'herrfurthplatz'], 3, liked(S.leyla, S.tobias, S.marek)),
    post(S.marek, 'Neu im Kiez: Tipps für die ersten Wochen?', 'Ich bin vor zwei Wochen aus Krakau hergezogen. Wo kauft ihr gern ein, wo kann man abends noch etwas essen, und gibt es einen Ort, an dem man Nachbarn kennenlernt? Dziękuję!', ['neu-hier', 'frage'], 4, liked(S.leyla, S.garten)),
    post(S.garten, 'Tempelhofer Feld: Wer hilft beim Beet-Aufbau?', 'Am Samstag bauen wir die Hochbeete für die neue Saison auf. Werkzeug ist da, Kaffee auch. Kommt vorbei, auch für eine Stunde. Çay ve poğaça bizden!', ['garten', 'tempelhofer-feld', 'mitmachen'], 5, liked(S.leyla, S.nour, S.tobias, S.fincan)),
    post(S.tobias, 'Lärm nachts am Wochenende: normal oder zu viel?', 'Seit ein paar Wochen ist es an den Wochenenden ab zwei Uhr sehr laut im Hinterhof. Ich möchte niemanden anzeigen, nur wissen, wie ihr damit umgeht. Warnung: Der Beitrag enthält ein wenig Frust.', ['laerm', 'nachbarschaft'], 6, { hasWarningLabel: true, warningText: 'Enthält emotionale Sprache – bitte sachlich bleiben.', ...liked(S.marek) }),
  ];
  // @mention of the demo member, stored the way resolveMentions() writes it
  topics.push(post(S.leyla, 'Kuchen für das Kiezfest: Liste ist offen', 'Für das Kiezfest sammeln wir Kuchenspenden. @demo_member hat letztes Jahr den Käsekuchen gebracht, magst du wieder? Alle anderen tragen sich bitte hier in den Kommentaren ein.', ['kiezfest', 'kuchen'], 7, { mentions: [{ handle: 'demo_member', userId: S.member }], ...liked(S.member, S.garten) }));
  // one still waiting in the moderation queue (not part of the public 12)
  const pendingTopic = post(S.marek, 'Verkaufe Kontakte – günstig!!!', 'Schnelles Geld, alle Infos per Nachricht, ruf an!!!', ['angebot'], 0, { moderationStatus: 'pending' });
  topics.push(pendingTopic);
  // rejected examples for the Protokoll
  const rejectedTopic = post(S.marek, 'Beschimpfung gegen einen Nachbarn', 'Dieser Beitrag wurde von der Moderation abgelehnt (Beispiel für das Protokoll).', ['streit'], 9, { moderationStatus: 'rejected', rejectionReason: 'Persönlicher Angriff auf eine Person.' });
  topics.push(rejectedTopic);

  const announcements = [
    post(S.admin, 'Willkommen in der Demo von Mahalle', 'Das hier ist eine Vorführung mit erfundenen Nachbarn und erfundenen Beiträgen. Du kannst alles ansehen, aber nichts verändern. Jede Nacht um vier Uhr wird alles zurückgesetzt.', ['demo', 'info'], 0, { isOfficial: true, pinnedUntil: daysAhead(5), description: 'Demo-Hinweis', editCount: 0 }),
    post(S.garten, 'Gemeinschaftsgarten: Neue Öffnungszeiten', 'Ab nächster Woche ist der Garten dienstags und samstags von 10 bis 16 Uhr offen. Gießdienst ist weiter gesucht, bitte kurz melden.', ['garten', 'info'], 2, { description: 'Öffnungszeiten', ...liked(S.leyla, S.nour) }),
    post(S.leyla, 'Straßenfest: Sperrung der Schillerpromenade am Sonntag', 'Am Sonntag ist die Schillerpromenade zwischen Herrfurthplatz und Kirche für Autos gesperrt. Bitte parkt nicht in den markierten Bereichen.', ['strassenfest', 'verkehr'], 3, { description: 'Sperrung', ...liked(S.tobias) }),
    post(S.fincan, 'Fincan öffnet sonntags früher', 'Ab sofort gibt es sonntags ab 8 Uhr Frühstück. Türkisches Frühstück für zwei, ein Çay inklusive – komm vorbei!', ['cafe', 'frühstück'], 8, { description: 'Neue Zeiten', ...liked(S.marek, S.nour, S.member) }),
  ];

  const recommendations = [
    post(S.nour, 'Beste Falafel im Kiez', 'Der kleine Laden an der Ecke, ehrlich, frisch und günstig. Dazu gibt es hausgemachte Soße. Am Freitagmittag ist die Schlange lang, es lohnt sich.', ['essen', 'falafel'], 2, { category: 'restaurant', description: 'Falafel', ...liked(S.leyla, S.tobias, S.marek) }),
    post(S.tobias, 'Reparatur-Café im Gemeindehaus', 'Jeden zweiten Donnerstag reparieren Freiwillige kaputte Toaster, Lampen und Fahrräder. Kostenlos, Spende willkommen.', ['reparatur', 'nachhaltig'], 6, { category: 'other', description: 'Reparatur', ...liked(S.leyla, S.nour, S.member) }),
  ];

  // ---------------------------------------------------------------- comments (_id also pushed into the parent's comments array)
  const comment = (author: string, parent: { _id: ObjectId }, body: string, ageDays: number, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), body, author, relevantPostId: parent._id, date: daysAgo(ageDays).getTime(), upvotes: 0,
    mentions: [] as unknown[], moderationStatus: 'approved', createdAt: daysAgo(ageDays), updatedAt: daysAgo(ageDays), ...extra,
  });
  const [tHof, tRad, tLaterne, tNeu, tBeet, , tKuchen] = topics;
  const comments = [
    comment(S.tobias, tHof, 'Ich bin dabei! Ich habe einen ganzen Karton Bücher und zwei Lampen.', 0.5),
    comment(S.garten, tHof, 'Wir können den Gemeinschaftsgarten als Treffpunkt für die Karte anbieten.', 0.4),
    comment(S.leyla, tRad, 'Probier es mal beim Reparatur-Café im Gemeindehaus, da helfen sie beim Selbermachen.', 1.5),
    comment(S.marek, tLaterne, 'Ich habe es eben gemeldet, Vorgangsnummer folgt.', 2),
    comment(S.nour, tNeu, 'Willkommen! Samstags ist ein kleiner Markt am Platz, da lernt man schnell Leute kennen.', 3),
    comment(S.leyla, tNeu, 'Und herzlich willkommen auf Deutsch, Polnisch oder Türkisch, hier geht alles. Hoş geldin!', 3),
    comment(S.fincan, tBeet, 'Wir bringen Çay und etwas zu essen vorbei.', 4),
    comment(S.member, tKuchen, 'Käsekuchen ist eingetragen, bringe ich am Samstag mit.', 5),
    comment(S.marek, tLaterne, 'Danke fürs Melden, bei mir im Hof ist es auch dunkel geworden.', 1.8),
    comment(S.nour, announcements[1], 'Super, ich übernehme den Gießdienst am Samstag.', 1),
  ] as ReturnType<typeof comment>[];
  // one comment waiting in the moderation queue (NOT pushed into the parent array)
  const pendingComment = comment(S.marek, tRad, 'Ihr seid alle doof, kauft doch bei mir!!!', 0, { moderationStatus: 'pending' });
  comments.push(pendingComment);
  for (const c of comments) {
    if (c.moderationStatus !== 'approved') continue;
    const parent = [...topics, ...announcements, ...recommendations].find((p) => String(p._id) === String(c.relevantPostId));
    parent?.comments.push(c._id);
  }

  // ---------------------------------------------------------------- events
  const ev = (author: string, title: string, body: string, category: string, location: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), title, body, author, startDate: start, endDate: end, location, category, capacity: null,
    allDay: false, visibility: 'public', tags: [] as string[], comments: [] as ObjectId[], views: 15, likes: 0,
    likedBy: [] as string[], rsvps: { going: [] as string[], maybe: [] as string[] }, date: Date.now(),
    moderationStatus: 'approved', createdAt: daysAgo(10), updatedAt: daysAgo(1), ...extra,
  });
  const fest = berlinDay(6);
  const markt = berlinDay(13);
  const events = [
    ev(S.garten, 'Beete aufbauen am Tempelhofer Feld', 'Wir bauen die Hochbeete auf. Bring gern Handschuhe mit.', 'kiez', 'Tempelhofer Feld', berlinAt(3, 10), berlinAt(3, 14), { tags: ['garten'], rsvps: { going: [S.leyla, S.nour], maybe: [S.member] } }),
    ev(S.leyla, 'Kiezfest am Herrfurthplatz', 'Musik, Kuchen, Kinderschminken. Der ganze Tag gehört der Nachbarschaft.', 'kiez', 'Herrfurthplatz', fest.start, fest.end, { allDay: true, tags: ['fest'], rsvps: { going: [S.tobias, S.garten, S.marek, S.member], maybe: [S.nour] } }),
    ev(S.fincan, 'Flohmarkt im Hinterhof', 'Trödel, Bücher, Kleidung. Standplatz bitte vorher anmelden.', 'markt', 'Hinterhof Café Fincan', markt.start, markt.end, { allDay: true, tags: ['flohmarkt'] }),
    ev(S.nour, 'Lesung: Kurzgeschichten aus dem Kiez', 'Nachbarn lesen eigene Texte, Eintritt frei. Auf Deutsch, Arabisch und Türkisch.', 'kultur', 'Gemeindehaus', berlinAt(8, 19, 30), berlinAt(8, 21, 30), { movedAt: hoursAgo(20), movedFromStart: berlinAt(7, 19, 0), rsvps: { going: [S.member], maybe: [] } }),
    ev(S.garten, 'Gartenwochenende (drei Tage)', 'Drei Tage Pflanzen, Basteln und Grillen im Gemeinschaftsgarten.', 'kiez', 'Gemeinschaftsgarten', berlinAt(10, 10), berlinAt(12, 18), { tags: ['garten'], rsvps: { going: [S.leyla], maybe: [S.tobias, S.marek] } }),
    ev(S.tobias, 'Nachbarschaftsabend im Kiezraum', 'Kennenlernen bei Tee und Gebäck. Der letzte Abend war schön, wir wiederholen ihn.', 'sonstiges', 'Kiezraum', berlinAt(-9, 18), berlinAt(-9, 21), { rsvps: { going: [S.leyla, S.nour, S.garten], maybe: [S.marek] } }),
  ];

  // ---------------------------------------------------------------- listings (mirror ListingCreateSchema; photos come later by hand)
  const listing = (sellerId: string, title: string, description: string, category: string, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), title, description, descriptionPlainText: description, listingType: 'sell', category, condition: 'good',
    price: 10, images: [] as unknown[], delivery: 'abholung', sellerId, status: 'available', moderationStatus: 'approved',
    views: 30, savedBy: [] as string[], createdAt: daysAgo(3), updatedAt: daysAgo(3), lastBumpedAt: daysAgo(3), ...extra,
  });
  const lReported = listing(S.marek, 'Rennrad, Rahmen 56', 'Gut erhaltenes Rennrad, neue Reifen. Probefahrt ist möglich.', 'fahrrad', { price: 180, condition: 'very-good', moderationStatus: 'pending', isUserReported: true, createdAt: daysAgo(1), lastBumpedAt: daysAgo(1) });
  const lWarned = listing(S.tobias, 'Alter Holzstuhl, Lack blättert', 'Stuhl hat Gebrauchsspuren, Lack blättert an der Lehne. Deshalb günstig.', 'moebel', { price: 8, condition: 'fair', hasWarningLabel: true, warningText: 'Zustand laut Anbieter deutlich gebraucht.' });
  const listings = [
    listing(S.leyla, 'Bücherregal Kiefer, 180 cm', 'Stabiles Regal, ein paar Kratzer. Abholung in der Schillerpromenade.', 'moebel', { price: 35, condition: 'good' }),
    listing(S.nour, 'Zimmerpflanzen zu verschenken', 'Monstera-Ableger und Grünlilien. Töpfe gibt es dazu. Bitte vorher melden.', 'pflanze', { listingType: 'gift', price: 0, createdAt: daysAgo(1), lastBumpedAt: daysAgo(1) }),
    listing(S.tobias, 'Tausche Kinderfahrrad gegen Laufrad', 'Kinderfahrrad 16 Zoll, ich suche ein kleines Laufrad für meine Nichte.', 'kinder', { listingType: 'exchange', price: 0, exchangeFor: 'Laufrad für Kleinkinder' }),
    listing(S.garten, 'Gießkannen und Pflanzschalen', 'Vom Gartenprojekt übrig, alles sauber. Abholung am Gartentor.', 'garten', { price: 12, status: 'reserved', reservedAt: hoursAgo(30) }),
    listing(S.fincan, 'Espressokocher, 6 Tassen', 'Italienischer Klassiker, funktioniert einwandfrei. Verkauft, bleibt zur Ansicht stehen.', 'sonstiges', { price: 15, status: 'sold', createdAt: daysAgo(10), lastBumpedAt: daysAgo(10) }),
    lWarned,
    lReported,
  ];
  const listingAuditTrail = [{
    _id: new ObjectId(), listingId: String(lWarned._id), event: 'edit_warning_cleared', editedAt: daysAgo(4), editedBy: S.tobias,
    preEditTitle: 'Holzstuhl', preEditBody: 'Stuhl, Lack blättert, Preis verhandelbar.', preEditImages: [] as string[],
    hadWarningLabel: true, preEditWarningText: 'Zustand laut Anbieter deutlich gebraucht.', createdAt: daysAgo(4),
  }];

  // ---------------------------------------------------------------- savedPosts
  const savedPosts = [tHof, tBeet, recommendations[1], announcements[1], tKuchen].map((p, i) => ({
    userId: S.member, postId: String(p._id), savedAt: daysAgo(i + 1),
  }));

  // ---------------------------------------------------------------- flaggedContent
  const aiRecord = (contentType: string, c: { _id: ObjectId; title?: string; body: string; tags?: string[] }, authorId: string, authorName: string, cats: string[], score: number, extra: Record<string, unknown> = {}) => ({
    _id: new ObjectId(), source: 'ai_moderation', contentType, contentId: String(c._id), title: c.title, body: c.body, tags: c.tags,
    authorId, authorName, authorEmail: undefined, decision: 'pending_review', flaggedCategories: cats,
    scores: Object.fromEntries(cats.map((k) => [k, score])), highestCategory: cats[0], maxScore: score,
    reviewStatus: 'pending', createdAt: hoursAgo(5), updatedAt: hoursAgo(5), ...extra,
  });
  const flagged = [
    aiRecord('topic', pendingTopic, S.marek, 'Marek Nowak', ['spam:ad_promotional'], 0.91),
    aiRecord('comment', pendingComment, S.marek, 'Marek Nowak', ['harassment'], 0.72, { parentPostId: String(tRad._id), parentCollection: 'topics', body: pendingComment.body }),
    {
      _id: new ObjectId(), source: 'user_report', contentType: 'marketplace', contentId: String(lReported._id), title: lReported.title,
      body: lReported.description, authorId: S.marek, authorName: 'Marek Nowak', decision: 'pending_review',
      flaggedCategories: ['Spam oder Werbung'], scores: {}, highestCategory: 'spam', maxScore: 0,
      reporterUserId: S.leyla, reporterUserIds: [S.leyla], reporterName: 'Leyla Demirkaya', reportReason: 'spam',
      reportDetails: 'Das Inserat steht gleichzeitig in drei Gruppen, der Preis wirkt unrealistisch.', reportCount: 1,
      isUserReported: true, reviewStatus: 'pending', createdAt: hoursAgo(3), updatedAt: hoursAgo(3),
    },
    // reviewed ones, for the Protokoll
    aiRecord('topic', tLaterne, S.nour, 'Nour Haddad', ['harassment'], 0.31, { decision: 'pending_review', reviewStatus: 'approved', reviewedBy: S.admin, reviewedAt: daysAgo(3), reviewNotes: 'Sachliche Kritik, kein Angriff.', createdAt: daysAgo(3), updatedAt: daysAgo(3) }),
    aiRecord('topic', topics[5], S.tobias, 'Tobias Wendt', ['harassment'], 0.44, { reviewStatus: 'approved', hasWarningLabel: true, warningText: 'Enthält emotionale Sprache – bitte sachlich bleiben.', reviewedBy: S.admin, reviewedAt: daysAgo(6), createdAt: daysAgo(6), updatedAt: daysAgo(6) }),
    aiRecord('topic', rejectedTopic, S.marek, 'Marek Nowak', ['harassment'], 0.88, { decision: 'urgent_review', reviewStatus: 'rejected', rejectionReason: 'Persönlicher Angriff auf eine Person.', reviewedBy: S.admin, reviewedAt: daysAgo(9), createdAt: daysAgo(9), updatedAt: daysAgo(9) }),
    {
      _id: new ObjectId(), source: 'user_report', contentType: 'comment', contentId: String(new ObjectId()), body: 'Beispiel eines gemeldeten und gelöschten Kommentars.',
      authorId: S.marek, authorName: 'Marek Nowak', decision: 'pending_review', flaggedCategories: ['Beleidigung'], scores: {},
      highestCategory: 'harassment', maxScore: 0, reporterUserId: S.nour, reporterUserIds: [S.nour], reporterName: 'Nour Haddad',
      reportReason: 'harassment', reportCount: 1, isUserReported: true, reviewStatus: 'rejected', rejectionReason: 'Beleidigung.',
      reviewedBy: S.admin, reviewedAt: daysAgo(12), createdAt: daysAgo(12), updatedAt: daysAgo(12),
    },
  ];

  // ---------------------------------------------------------------- notifications (12 for the two demo users)
  const n = (userId: string, type: string, actorId: string | undefined, target: Record<string, unknown>, ageHours: number, unread = false, meta?: Record<string, unknown>) => ({
    _id: new ObjectId(), userId, type, ...(actorId ? { actorId } : {}), target, ...(meta ? { meta } : {}),
    createdAt: hoursAgo(ageHours), readAt: unread ? null : hoursAgo(ageHours - 1),
  });
  const tgt = (contentType: string, c: { _id: ObjectId; title: string }, href: string) => ({ contentType, contentId: String(c._id), title: c.title, href });
  const notifications = [
    n(S.member, 'comment', S.tobias, tgt('topic', tHof, `/topics/${tHof._id}`), 12, true, { sourceId: String(comments[0]._id) }),
    n(S.member, 'comment', S.garten, tgt('topic', tHof, `/topics/${tHof._id}`), 11, true, { sourceId: String(comments[1]._id) }),
    n(S.member, 'mention', S.leyla, tgt('topic', tKuchen, `/topics/${tKuchen._id}`), 150, false, { sourceId: String(tKuchen._id) }),
    n(S.member, 'official', S.admin, tgt('announcement', announcements[0], `/announcements/${announcements[0]._id}`), 24, false),
    n(S.member, 'moderation', S.admin, tgt('topic', tKuchen, `/topics/${tKuchen._id}`), 200, false, { outcome: 'approved', contentKind: 'topic', sourceId: String(tKuchen._id) }),
    n(S.member, 'blog', undefined, { contentType: 'blog', contentId: 'das-mahalle-manifest', title: 'Das Mahalle-Manifest', href: '/blog/das-mahalle-manifest' }, 72, false),
    n(S.member, 'event_moved', S.nour, tgt('event', events[3], `/calendar?event=${events[3]._id}`), 20, false, { change: 'date', startISO: events[3].startDate.toISOString(), endISO: events[3].endDate.toISOString(), allDay: false, place: 'Gemeindehaus' }),
    n(S.admin, 'moderation', S.marek, tgt('topic', pendingTopic, '/admin/moderation'), 5, true, { contentKind: 'topic' }),
    n(S.admin, 'comment', S.leyla, tgt('topic', tRad, `/topics/${tRad._id}`), 40, false, { sourceId: String(comments[2]._id) }),
    n(S.admin, 'official', S.admin, tgt('announcement', announcements[0], `/announcements/${announcements[0]._id}`), 24, false),
    n(S.admin, 'blog', undefined, { contentType: 'blog', contentId: 'klein-ist-nicht-zu-klein', title: 'Klein ist nicht zu klein', href: '/blog/klein-ist-nicht-zu-klein' }, 96, false),
    n(S.admin, 'event_moved', S.nour, tgt('event', events[3], `/calendar?event=${events[3]._id}`), 20, false, { change: 'date', startISO: events[3].startDate.toISOString(), endISO: events[3].endDate.toISOString(), allDay: false, place: 'Gemeindehaus' }),
  ];

  // ---------------------------------------------------------------- blog claims (superset on purpose: a miss would announce a post)
  const blogDir = join(process.cwd(), 'src', 'content', 'blog');
  const blogIds = readdirSync(blogDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.mdx'))
    .map((f) => f.name.replace(/\.mdx$/, ''));
  const blogAnnouncements = blogIds.map((id) => ({ _id: id as unknown as ObjectId, announcedAt: now }));

  const seeded: Record<string, unknown[]> = {
    users, topics, announcements, recommendations, comments, events, listings, savedPosts,
    notifications, flaggedContent: flagged, listingAuditTrail,
  };

  // ---------------------------------------------------------------- report / write
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN (no --write): would write'} to "${dbName}":`);
  for (const name of DROP) console.log(`  ${name}: drop, then ${seeded[name]?.length ?? 0} seeded`);
  console.log(`  blogAnnouncements: replaced with ${blogAnnouncements.length} slugs`);
  console.log(`  news: untouched`);
  console.log(KIEZ_SOURCE ? `  schillerkiez_* (5 collections): ${WRITE ? 'copied' : 'would be copied'} from the given source` : '  schillerkiez_*: untouched');
  if (!WRITE) {
    console.log('\nNothing written. Re-run with --write.');
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db(dbName);
  try {
    for (const name of DROP) {
      await db.collection(name).deleteMany({});
      const docs = seeded[name];
      if (docs?.length) await db.collection(name).insertMany(docs as any[]);
    }
    await db.collection('blogAnnouncements').deleteMany({});
    if (blogAnnouncements.length) await db.collection('blogAnnouncements').insertMany(blogAnnouncements as any[]);

    if (KIEZ_SOURCE) {
      const src = new MongoClient(KIEZ_SOURCE);
      await src.connect();
      try {
        const srcDb = src.db(); // name from the URI path; never printed
        for (const name of KIEZ_COLLECTIONS) {
          const docs = await srcDb.collection(name).find({}).toArray();
          await db.collection(name).deleteMany({});
          if (docs.length) await db.collection(name).insertMany(docs as any[]);
          console.log(`  ${name}: copied ${docs.length}`);
        }
      } finally {
        await src.close();
      }
    }
    console.log(`\nSeeded "${dbName}". Demo accounts: demo_member, demo_admin (no passwords).`);
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
