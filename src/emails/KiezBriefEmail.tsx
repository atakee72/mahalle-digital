import {
  Body, Column, Container, Head, Heading, Html, Img, Link, Preview, Row, Section, Text,
} from '@react-email/components';
import * as React from 'react';
import {
  AIR_LABEL, LISTING_KIND_LABEL, LISTING_KIND_SYMBOL, MAIL_COPY, POST_KIND_LABEL, UNSUB_PLACEHOLDER, VERIFY_PLACEHOLDER, fmtPrice, newsLineFor, pairs, preheaderFor, weekLabel, withUtm,
  type BriefData, type BriefEvent, type MailLocale,
} from '../lib/newsletter/kiezBriefRules';

interface KiezBriefEmailProps {
  data: BriefData;
  /** Absolute origin (NEXTAUTH_URL) for the mail — never hardcode the domain here. '' for the browser view (relative links). */
  baseUrl: string;
  /** The member's stored app language (users.locale); German when absent. */
  locale?: MailLocale;
  /** true = the browser view (/kiez-brief/<week>): the top line links to the list instead of to itself. */
  web?: boolean;
}

const POST_PATH = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' } as const;

// Section colours = the app's bars (tokens.css): Forum wine, Kalender teal, Markt ochre, Beilage rust,
// Kurier ink, the team's own news plum (the admin colour).
const WINE = '#b23a5b';
const TEAL = '#3f8f9f';
const OCHRE = '#d68a1a';
const RUST = '#a3552e';
const PLUM = '#6f2f59';
const INK = '#1b1a17';
const PAPER = '#f3ead8';

const MONTHS: Record<MailLocale, string[]> = {
  de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS: Record<MailLocale, string[]> = {
  de: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

function berlin(ms: number, locale: MailLocale) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    wd: WEEKDAYS[locale][['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))],
    day: get('day'), month: MONTHS[locale][Number(get('month')) - 1],
    time: `${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`,
  };
}

// The weekly member mail. Rendered ONCE per issue AND language (German, English — the member's
// stored app toggle); the unsubscribe link prints UNSUB_PLACEHOLDER and the greeting NAME_PLACEHOLDER,
// and the sender substitutes each recipient's token and (escaped) name. Member content (titles,
// excerpts) stays as written; in the English mail the post links ask the page to open translated.
// Images are optional garnish: Gmail/Outlook show them only after the reader allows images,
// so every row reads complete without them. Reads well linearised on purpose (Resend derives
// the text part from this HTML). The same markup is the browser view (`web`): only the top line differs.
// Order (owner, 2026-10-04): what WAS — Forum, Beilage, Markt, the Kurier teaser, Neu bei Mahalle —
// then what COMES: next week's events, two cards to a row, as the closing part.
export default function KiezBriefEmail({ data, baseUrl, locale = 'de', web = false }: KiezBriefEmailProps) {
  const c = MAIL_COPY[locale];
  const url = (path: string) => withUtm(`${baseUrl}${path}`);
  /** content links: the English mail asks the post page for its translation */
  const post = (path: string) => withUtm(`${baseUrl}${path}`, locale === 'en');
  const abs = (src: string) => (src.startsWith('http') ? src : `${baseUrl}${src}`);
  return (
    <Html lang={locale}>
      <Head>
        {/* phones open the browser view: without it the 520 px card renders on a 980 px canvas */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`Kiez-Brief · ${weekLabel(data.week, locale)}`}</title>
      </Head>
      <Preview>{preheaderFor(data, locale)}</Preview>
      <Body style={bodyStyle}>
        <Text style={topLine}>
          {web
            ? <Link href={`${baseUrl}/kiez-brief`} target="_self" style={mutedLink}>{`← ${c.allIssues}`}</Link>
            : <Link href={url(`/kiez-brief/${data.week}`)} style={mutedLink}>{c.viewInBrowser}</Link>}
        </Text>
        {/* '' for a confirmed member; for the others one quiet line under the top link (owner: no
            frame, not inside the letter — „we wouldnt want to open a newsletter with a warning") */}
        <div>{VERIFY_PLACEHOLDER}</div>
        <Container style={containerStyle}>
          {/* Masthead: the app's disc + wordmark on a rust band */}
          <Section style={mast}>
            <Row>
              <Column style={{ width: '44px', verticalAlign: 'middle' }}>
                <Link href={url('/forum')} style={wordmarkLink}>
                  <Img src={`${baseUrl}/icons/icon-192.png`} width="36" height="36" alt="Mahalle" style={{ borderRadius: '999px', border: `1.5px solid ${PAPER}` }} />
                </Link>
              </Column>
              <Column style={{ verticalAlign: 'middle' }}>
                <Text style={wordmark}><Link href={url('/forum')} style={wordmarkLink}>mahalle</Link></Text>
                <Text style={mastKicker}>SCHILLERKIEZ · KIEZ-BRIEF · {weekLabel(data.week, locale).toUpperCase()}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={inner}>
            <Heading style={h1}>{c.title}</Heading>
            <Text style={hello}>
              <strong>{c.greeting}</strong> {c.intro}
              {c.linksHint ? <><br /><span style={meta}>{c.linksHint}</span></> : null}
            </Text>

            {data.posts.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(WINE)}>{c.forum}</Heading>
                {data.posts.map((p) => (
                  <Row key={p.id} style={row}>
                    <Column style={{ verticalAlign: 'top' }}>
                      <Text style={item}>
                        <span style={tag(WINE)}>{POST_KIND_LABEL[locale][p.kind]}</span><br />
                        <Link href={post(`/${POST_PATH[p.kind]}/${p.id}`)} style={link}>{p.title}</Link>
                        {p.excerpt ? <><br /><span style={excerpt}>{p.excerpt}</span></> : null}
                        <br /><span style={meta}>{p.author ?? c.formerMember}{p.comments > 0 ? ` · ${p.comments} ${p.comments === 1 ? c.reply : c.replies}` : ''}</span>
                      </Text>
                    </Column>
                    {p.image ? (
                      <Column style={{ width: '72px', verticalAlign: 'top', paddingLeft: '12px' }}>
                        <Img src={p.image} width="60" height="60" alt="" style={thumbImg} />
                      </Column>
                    ) : null}
                  </Row>
                ))}
              </Section>
            )}

            {data.blog.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(RUST)}>{c.blog}</Heading>
                {data.blog.map((b) => (
                  <Section key={b.slug} style={row}>
                    {b.cover ? (
                      <Link href={post(`/blog/${b.slug}`)}>
                        <Img src={abs(b.cover)} width="456" alt="" style={coverImg} />
                      </Link>
                    ) : null}
                    <Text style={item}>
                      <Link href={post(`/blog/${b.slug}`)} style={link}>{b.title}</Link>
                      <br /><span style={excerpt}>{b.description}</span>
                    </Text>
                  </Section>
                ))}
              </Section>
            )}

            {data.listings.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(OCHRE)}>{c.market}</Heading>
                {data.listings.map((l) => (
                  <Row key={l.id} style={row}>
                    <Column style={{ width: '72px', verticalAlign: 'top' }}>
                      {l.image
                        ? <Img src={l.image} width="60" height="60" alt="" style={thumbImg} />
                        : <div style={placeholderTile}>{LISTING_KIND_SYMBOL[l.kind]}</div>}
                    </Column>
                    <Column style={{ verticalAlign: 'top' }}>
                      <Text style={item}>
                        <span style={tag(OCHRE)}>{LISTING_KIND_LABEL[locale][l.kind]}</span><br />
                        <Link href={post(`/marketplace/${l.id}`)} style={link}>{l.title}</Link>
                        {fmtPrice(l.price, locale) ? <span style={meta}> · {fmtPrice(l.price, locale)}</span> : null}
                      </Text>
                    </Column>
                  </Row>
                ))}
              </Section>
            )}

            {data.newsCount > 0 && (
              <Section>
                <Heading as="h2" style={h2(INK)}>{c.news}</Heading>
                <Text style={item}>
                  {newsLineFor(data.newsCount, locale)}{' '}
                  <Link href={url('/newsboard')} style={link}>{`${c.newsCta} →`}</Link>
                </Text>
              </Section>
            )}

            {data.official.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(PLUM)}>{c.official}</Heading>
                {data.official.map((o) => (
                  <Section key={o.id} style={row}>
                    <Text style={item}>
                      <Link href={post(`/announcements/${o.id}`)} style={link}>{o.title}</Link>
                      {o.excerpt ? <><br /><span style={excerpt}>{o.excerpt}</span></> : null}
                    </Text>
                  </Section>
                ))}
              </Section>
            )}

            {data.events.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(TEAL)}>{c.events}</Heading>
                {pairs(data.events).map(([a, b]) => (
                  <Row key={a.id} style={gridRow}>
                    <Column style={card}><EventCard e={a} href={url('/calendar')} locale={locale} /></Column>
                    <Column style={gutter}>{'\u00a0'}</Column>
                    {b
                      ? <Column style={card}><EventCard e={b} href={url('/calendar')} locale={locale} /></Column>
                      : <Column style={cardEmpty}>{'\u00a0'}</Column>}
                  </Row>
                ))}
              </Section>
            )}

            {data.air ? (
              <Text style={air}>{c.air} <strong>{AIR_LABEL[locale][data.air.lqi]}</strong> (LQI {data.air.lqi}) · {c.station}</Text>
            ) : null}

            <Section style={{ textAlign: 'center' as const, margin: '26px 0 6px' }}>
              <Link href={url('/forum')} style={button}>{c.cta}</Link>
            </Section>
          </Section>

          <Section style={foot}>
            <Text style={muted}>
              {c.why}{' '}
              <Link href={UNSUB_PLACEHOLDER} style={mutedLink}>{c.unsubscribe}</Link> ·{' '}
              <Link href={url('/profile')} style={mutedLink}>{c.settings}</Link> ·{' '}
              <Link href={`${baseUrl}/impressum`} style={mutedLink}>{c.imprint}</Link> ·{' '}
              <Link href={`${baseUrl}/datenschutz`} style={mutedLink}>{c.privacy}</Link>
            </Text>
            <Text style={muted}>Mahalle · Schillerkiez · Neukölln</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// One event card of the two-column grid: date tile and weekday/time side by side, the title under them.
function EventCard({ e, href, locale }: { e: BriefEvent; href: string; locale: MailLocale }) {
  const d = berlin(e.startMs, locale);
  return (
    <>
      <Row>
        <Column style={{ width: '60px', verticalAlign: 'middle' }}>
          <div style={dateTile}>
            <div style={tileDay}>{d.day}</div>
            <div style={tileMonth}>{d.month}</div>
          </div>
        </Column>
        <Column style={{ verticalAlign: 'middle' }}>
          <Text style={cardWhen}>{d.wd}<br />{e.allDay ? MAIL_COPY[locale].allDay : d.time}</Text>
        </Column>
      </Row>
      <Text style={cardText}>
        <Link href={href} style={link}>{e.title}</Link>
        {e.location ? <><br /><span style={meta}>{e.location}</span></> : null}
      </Text>
    </>
  );
}

const bodyStyle = { backgroundColor: PAPER, fontFamily: 'Georgia, serif', padding: '24px 12px' };
const containerStyle = { backgroundColor: '#f7f0de', border: `1.5px solid ${INK}`, borderRadius: '12px', maxWidth: '520px', overflow: 'hidden' as const };
const topLine = { color: '#7a7264', fontSize: '12px', textAlign: 'center' as const, margin: '0 0 10px' };
const mast = { backgroundColor: RUST, padding: '14px 24px', borderBottom: `1.5px solid ${INK}` };
const wordmark = { color: PAPER, fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: '1.1' };
const wordmarkLink = { color: PAPER, textDecoration: 'none' };
const mastKicker = { color: PAPER, fontFamily: 'Menlo, Consolas, monospace', fontSize: '9px', letterSpacing: '0.14em', margin: '2px 0 0', opacity: 0.85 };
const inner = { padding: '22px 24px 8px' };
const foot = { padding: '12px 24px 18px', borderTop: '1px solid #c9bea3', backgroundColor: PAPER };
const h1 = { color: INK, fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 10px' };
const hello = { color: '#3a362e', fontSize: '15px', lineHeight: '1.5', margin: '0 0 4px' };
const h2 = (color: string) => ({ color, fontSize: '12px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' as const, borderTop: `2px solid ${color}`, paddingTop: '10px', margin: '22px 0 10px', fontFamily: 'Menlo, Consolas, monospace' });
const row = { marginBottom: '12px' };
const item = { color: '#3a362e', fontSize: '15px', lineHeight: '1.45', margin: 0 };
const tag = (color: string) => ({ color, fontFamily: 'Menlo, Consolas, monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' as const });
const link = { color: INK, fontWeight: 700, textDecoration: 'underline' };
const excerpt = { color: '#5a5448', fontSize: '13.5px' };
const meta = { color: '#7a7264', fontSize: '12.5px' };
const thumbImg = { borderRadius: '6px', border: `1px solid ${INK}`, display: 'block' as const };
const placeholderTile = { width: '60px', height: '60px', lineHeight: '60px', textAlign: 'center' as const, borderRadius: '6px', border: `1px solid ${INK}`, backgroundColor: '#f0d9a8', color: OCHRE, fontFamily: 'Menlo, Consolas, monospace', fontSize: '22px', fontWeight: 700 };
const coverImg = { width: '100%', height: 'auto', borderRadius: '8px', border: `1.5px solid ${INK}`, display: 'block' as const, marginBottom: '8px' };
const dateTile = { width: '52px', border: `1.5px solid ${INK}`, borderRadius: '8px', textAlign: 'center' as const, backgroundColor: '#fbf6e9', overflow: 'hidden' as const };
// Events grid: two cards and a gutter per table row. Tables only — no flex/grid in mail clients.
// `table-layout: fixed` holds the 48/4/48 split: with the automatic layout one long word
// („Nachbarschaftsfrühstück") widened its card and pushed the whole mail past a phone's width.
const gridRow = { marginBottom: '10px', tableLayout: 'fixed' as const, width: '100%' };
const card = { width: '48%', verticalAlign: 'top' as const, border: `1px solid ${INK}`, borderRadius: '8px', backgroundColor: PAPER, padding: '10px' };
const cardEmpty = { width: '48%', fontSize: '1px', lineHeight: '1px' };
const gutter = { width: '4%', fontSize: '1px', lineHeight: '1px' };
const cardWhen = { color: '#5a5448', fontFamily: 'Menlo, Consolas, monospace', fontSize: '11px', lineHeight: '1.4', letterSpacing: '0.04em', margin: 0 };
const cardText = { color: '#3a362e', fontSize: '14px', lineHeight: '1.4', margin: '8px 0 0', wordBreak: 'break-word' as const, overflowWrap: 'anywhere' as const }; // no `hyphens: auto`: with lang=de it split words that fitted on the next line („Lo-kal“)
const tileDay = { fontSize: '20px', fontWeight: 800, color: INK, lineHeight: '1.1', padding: '6px 0 0' };
const tileMonth = { fontFamily: 'Menlo, Consolas, monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: PAPER, backgroundColor: TEAL, padding: '2px 0 3px', marginTop: '4px' };
const air = { color: '#5a5448', fontSize: '13px', margin: '18px 0 0', paddingTop: '12px', borderTop: '1px dashed #c9bea3' };
const button = { backgroundColor: INK, color: PAPER, fontSize: '14px', fontWeight: 700, padding: '11px 22px', borderRadius: '999px', textDecoration: 'none', display: 'inline-block' as const };
const muted = { color: '#7a7264', fontSize: '12px', lineHeight: '1.5', margin: '8px 0 0' };
const mutedLink = { color: '#7a7264', textDecoration: 'underline' };
