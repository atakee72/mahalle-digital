import {
  Body, Column, Container, Head, Heading, Html, Img, Link, Preview, Row, Section, Text,
} from '@react-email/components';
import * as React from 'react';
import {
  AIR_LABEL, LISTING_KIND_LABEL, POST_KIND_LABEL, UNSUB_PLACEHOLDER, fmtPrice, preheaderFor, weekLabel, withUtm,
  type BriefData, type BriefEvent,
} from '../lib/newsletter/kiezBriefRules';

interface KiezBriefEmailProps {
  data: BriefData;
  /** Absolute origin (NEXTAUTH_URL) — never hardcode the domain here. */
  baseUrl: string;
}

const POST_PATH = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' } as const;

// Section colours = the app's bars (tokens.css): Forum wine, Kalender teal, Markt ochre, Beilage rust.
const WINE = '#b23a5b';
const TEAL = '#3f8f9f';
const OCHRE = '#d68a1a';
const RUST = '#a3552e';
const INK = '#1b1a17';
const PAPER = '#f3ead8';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function berlin(ms: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    wd: WEEKDAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))],
    day: get('day'), month: MONTHS[Number(get('month')) - 1],
    time: `${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`,
  };
}

// The weekly member mail. Rendered ONCE per issue; the unsubscribe link prints the
// UNSUB_PLACEHOLDER and the sender substitutes each recipient's token. German only, like push.
// Images are optional garnish: Gmail/Outlook show them only after the reader allows images,
// so every row reads complete without them. Reads well linearised on purpose (Resend derives
// the text part from this HTML).
export default function KiezBriefEmail({ data, baseUrl }: KiezBriefEmailProps) {
  const url = (path: string) => withUtm(`${baseUrl}${path}`);
  const abs = (src: string) => (src.startsWith('http') ? src : `${baseUrl}${src}`);
  return (
    <Html lang="de">
      <Head />
      <Preview>{preheaderFor(data)}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Masthead: the app's disc + wordmark on a rust band */}
          <Section style={mast}>
            <Row>
              <Column style={{ width: '44px', verticalAlign: 'middle' }}>
                <Img src={`${baseUrl}/icons/icon-192.png`} width="36" height="36" alt="" style={{ borderRadius: '999px', border: `1.5px solid ${PAPER}` }} />
              </Column>
              <Column style={{ verticalAlign: 'middle' }}>
                <Text style={wordmark}>mahalle</Text>
                <Text style={mastKicker}>SCHILLERKIEZ · KIEZ-BRIEF · {weekLabel(data.week).toUpperCase()}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={inner}>
            <Heading style={h1}>Das war die Woche im Kiez</Heading>

            {data.posts.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(WINE)}>Im Forum</Heading>
                {data.posts.map((p) => (
                  <Row key={p.id} style={row}>
                    <Column style={{ verticalAlign: 'top' }}>
                      <Text style={item}>
                        <span style={tag(WINE)}>{POST_KIND_LABEL[p.kind]}</span><br />
                        <Link href={url(`/${POST_PATH[p.kind]}/${p.id}`)} style={link}>{p.title}</Link>
                        {p.excerpt ? <><br /><span style={excerpt}>{p.excerpt}</span></> : null}
                        <br /><span style={meta}>{p.author ?? 'Ehemaliges Mitglied'}{p.comments > 0 ? ` · ${p.comments} ${p.comments === 1 ? 'Antwort' : 'Antworten'}` : ''}</span>
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

            {data.events.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(TEAL)}>Nächste Woche im Kiez</Heading>
                {data.events.map((e) => <EventRow key={e.id} e={e} href={url('/calendar')} />)}
              </Section>
            )}

            {data.listings.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(OCHRE)}>Neu auf dem Markt</Heading>
                {data.listings.map((l) => (
                  <Row key={l.id} style={row}>
                    <Column style={{ width: '72px', verticalAlign: 'top' }}>
                      {l.image
                        ? <Img src={l.image} width="60" height="60" alt="" style={thumbImg} />
                        : <div style={placeholderTile}>{LISTING_KIND_LABEL[l.kind].slice(0, 1)}</div>}
                    </Column>
                    <Column style={{ verticalAlign: 'top' }}>
                      <Text style={item}>
                        <span style={tag(OCHRE)}>{LISTING_KIND_LABEL[l.kind]}</span><br />
                        <Link href={url(`/marketplace/${l.id}`)} style={link}>{l.title}</Link>
                        {fmtPrice(l.price) ? <span style={meta}> · {fmtPrice(l.price)}</span> : null}
                      </Text>
                    </Column>
                  </Row>
                ))}
              </Section>
            )}

            {data.blog.length > 0 && (
              <Section>
                <Heading as="h2" style={h2(RUST)}>In der Beilage</Heading>
                {data.blog.map((b) => (
                  <Section key={b.slug} style={row}>
                    {b.cover ? (
                      <Link href={url(`/blog/${b.slug}`)}>
                        <Img src={abs(b.cover)} width="456" alt="" style={coverImg} />
                      </Link>
                    ) : null}
                    <Text style={item}>
                      <Link href={url(`/blog/${b.slug}`)} style={link}>{b.title}</Link>
                      <br /><span style={excerpt}>{b.description}</span>
                    </Text>
                  </Section>
                ))}
              </Section>
            )}

            {data.air ? (
              <Text style={air}>Luftqualität heute: <strong>{AIR_LABEL[data.air.lqi]}</strong> (LQI {data.air.lqi}) · Station Nansenstraße</Text>
            ) : null}

            <Section style={{ textAlign: 'center' as const, margin: '26px 0 6px' }}>
              <Link href={url('/forum')} style={button}>Zum Forum</Link>
            </Section>
          </Section>

          <Section style={foot}>
            <Text style={muted}>
              Du bekommst diesen Brief einmal die Woche, weil du Mitglied bei Mahalle bist.{' '}
              <Link href={UNSUB_PLACEHOLDER} style={mutedLink}>Abbestellen</Link> ·{' '}
              <Link href={url('/forum')} style={mutedLink}>Mitteilungen einstellen</Link> ·{' '}
              <Link href={`${baseUrl}/impressum`} style={mutedLink}>Impressum</Link> ·{' '}
              <Link href={`${baseUrl}/datenschutz`} style={mutedLink}>Datenschutz</Link>
            </Text>
            <Text style={muted}>Mahalle · Schillerkiez · Neukölln</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function EventRow({ e, href }: { e: BriefEvent; href: string }) {
  const d = berlin(e.startMs);
  return (
    <Row style={row}>
      <Column style={{ width: '64px', verticalAlign: 'top' }}>
        <div style={dateTile}>
          <div style={tileDay}>{d.day}</div>
          <div style={tileMonth}>{d.month}</div>
        </div>
      </Column>
      <Column style={{ verticalAlign: 'top' }}>
        <Text style={item}>
          <span style={meta}>{d.wd}. · {e.allDay ? 'ganztägig' : d.time}</span><br />
          <Link href={href} style={link}>{e.title}</Link>
          {e.location ? <><br /><span style={meta}>{e.location}</span></> : null}
        </Text>
      </Column>
    </Row>
  );
}

const bodyStyle = { backgroundColor: PAPER, fontFamily: 'Georgia, serif', padding: '24px 12px' };
const containerStyle = { backgroundColor: '#f7f0de', border: `1.5px solid ${INK}`, borderRadius: '12px', maxWidth: '520px', overflow: 'hidden' as const };
const mast = { backgroundColor: RUST, padding: '14px 24px', borderBottom: `1.5px solid ${INK}` };
const wordmark = { color: PAPER, fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: '1.1' };
const mastKicker = { color: PAPER, fontFamily: 'Menlo, Consolas, monospace', fontSize: '9px', letterSpacing: '0.14em', margin: '2px 0 0', opacity: 0.85 };
const inner = { padding: '22px 24px 8px' };
const foot = { padding: '12px 24px 18px', borderTop: '1px solid #c9bea3', backgroundColor: PAPER };
const h1 = { color: INK, fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px' };
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
const dateTile = { width: '52px', border: `1.5px solid ${INK}`, borderRadius: '8px', textAlign: 'center' as const, backgroundColor: PAPER, overflow: 'hidden' as const };
const tileDay = { fontSize: '20px', fontWeight: 800, color: INK, lineHeight: '1.1', padding: '6px 0 0' };
const tileMonth = { fontFamily: 'Menlo, Consolas, monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: PAPER, backgroundColor: TEAL, padding: '2px 0 3px', marginTop: '4px' };
const air = { color: '#5a5448', fontSize: '13px', margin: '18px 0 0', paddingTop: '12px', borderTop: '1px dashed #c9bea3' };
const button = { backgroundColor: INK, color: PAPER, fontSize: '14px', fontWeight: 700, padding: '11px 22px', borderRadius: '999px', textDecoration: 'none', display: 'inline-block' as const };
const muted = { color: '#7a7264', fontSize: '12px', lineHeight: '1.5', margin: '8px 0 0' };
const mutedLink = { color: '#7a7264', textDecoration: 'underline' };
