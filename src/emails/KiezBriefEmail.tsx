import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Link, Hr,
} from '@react-email/components';
import * as React from 'react';
import {
  AIR_LABEL, LISTING_KIND_LABEL, POST_KIND_LABEL, UNSUB_PLACEHOLDER, fmtEventWhen, fmtPrice, preheaderFor,
  weekLabel, withUtm, type BriefData,
} from '../lib/newsletter/kiezBriefRules';

interface KiezBriefEmailProps {
  data: BriefData;
  /** Absolute origin (NEXTAUTH_URL) — never hardcode the domain here. */
  baseUrl: string;
}

const POST_PATH = { topic: 'topics', announcement: 'announcements', recommendation: 'recommendations' } as const;

// The weekly member mail. Rendered ONCE per issue; the unsubscribe link prints the
// UNSUB_PLACEHOLDER and the sender substitutes each recipient's token. German only, like push.
// Reads well linearised on purpose: Resend derives the text part from this HTML.
export default function KiezBriefEmail({ data, baseUrl }: KiezBriefEmailProps) {
  const url = (path: string) => withUtm(`${baseUrl}${path}`);
  return (
    <Html lang="de">
      <Head />
      <Preview>{preheaderFor(data)}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={kicker}>MAHALLE · SCHILLERKIEZ · KIEZ-BRIEF · {weekLabel(data.week).toUpperCase()}</Text>
          <Heading style={h1}>Das war die Woche im Kiez</Heading>

          {data.posts.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Im Forum</Heading>
              {data.posts.map((p) => (
                <Text key={p.id} style={item}>
                  <span style={tag}>{POST_KIND_LABEL[p.kind]}</span>{' '}
                  <Link href={url(`/${POST_PATH[p.kind]}/${p.id}`)} style={link}>{p.title}</Link>
                  <span style={meta}>{p.author ? ` · ${p.author}` : ''}{p.comments > 0 ? ` · ${p.comments} ${p.comments === 1 ? 'Antwort' : 'Antworten'}` : ''}</span>
                </Text>
              ))}
            </Section>
          )}

          {data.events.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Nächste Woche im Kiez</Heading>
              {data.events.map((e) => (
                <Text key={e.id} style={item}>
                  <span style={meta}>{fmtEventWhen(e.startMs, e.allDay)}</span><br />
                  <Link href={url('/calendar')} style={link}>{e.title}</Link>
                  {e.location ? <span style={meta}> · {e.location}</span> : null}
                </Text>
              ))}
            </Section>
          )}

          {data.listings.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>Neu auf dem Markt</Heading>
              {data.listings.map((l) => (
                <Text key={l.id} style={item}>
                  <span style={tag}>{LISTING_KIND_LABEL[l.kind]}</span>{' '}
                  <Link href={url(`/marketplace/${l.id}`)} style={link}>{l.title}</Link>
                  {fmtPrice(l.price) ? <span style={meta}> · {fmtPrice(l.price)}</span> : null}
                </Text>
              ))}
            </Section>
          )}

          {data.blog.length > 0 && (
            <Section>
              <Heading as="h2" style={h2}>In der Beilage</Heading>
              {data.blog.map((b) => (
                <Text key={b.slug} style={item}>
                  <Link href={url(`/blog/${b.slug}`)} style={link}>{b.title}</Link>
                  <br /><span style={meta}>{b.description}</span>
                </Text>
              ))}
            </Section>
          )}

          {data.air ? (
            <Text style={muted}>Luftqualität heute: {AIR_LABEL[data.air.lqi]} (LQI {data.air.lqi}) · Station Nansenstraße</Text>
          ) : null}

          <Hr style={hr} />
          <Text style={muted}>
            Du bekommst diesen Brief einmal die Woche, weil du Mitglied bei Mahalle bist.{' '}
            <Link href={UNSUB_PLACEHOLDER} style={mutedLink}>Abbestellen</Link> ·{' '}
            <Link href={url('/forum')} style={mutedLink}>Mitteilungen einstellen</Link> ·{' '}
            <Link href={`${baseUrl}/impressum`} style={mutedLink}>Impressum</Link> ·{' '}
            <Link href={`${baseUrl}/datenschutz`} style={mutedLink}>Datenschutz</Link>
          </Text>
          <Text style={muted}>Mahalle · Schillerkiez · Neukölln</Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = { backgroundColor: '#f3ead8', fontFamily: 'Georgia, serif', padding: '24px' };
const containerStyle = { backgroundColor: '#f7f0de', border: '1.5px solid #1b1a17', borderRadius: '12px', padding: '32px', maxWidth: '520px' };
const kicker = { color: '#a3552e', fontFamily: 'Menlo, Consolas, monospace', fontSize: '10px', letterSpacing: '0.14em', margin: '0 0 8px' };
const h1 = { color: '#1b1a17', fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 18px' };
const h2 = { color: '#1b1a17', fontSize: '15px', fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase' as const, borderTop: '1.5px solid #1b1a17', paddingTop: '12px', margin: '22px 0 8px' };
const item = { color: '#3a362e', fontSize: '15px', lineHeight: '1.5', margin: '0 0 10px' };
const tag = { color: '#b23a5b', fontFamily: 'Menlo, Consolas, monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' as const };
const link = { color: '#1b1a17', fontWeight: 700, textDecoration: 'underline' };
const meta = { color: '#7a7264', fontSize: '13px' };
const muted = { color: '#7a7264', fontSize: '12px', lineHeight: '1.5', margin: '8px 0 0' };
const mutedLink = { color: '#7a7264', textDecoration: 'underline' };
const hr = { borderColor: '#c9bea3', margin: '20px 0' };
