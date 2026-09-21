// Pure view-model mapping for the Kiez-Daten kiosk page. NO db/fetch imports —
// this must stay client-safe (imported by both server-rendered .astro
// frontmatter and client-hydrated Svelte islands).
import type { AgeDistributionEntry, DynamikClass, KiezStatsResponse, PlrAreaDetail } from '../../types/kiezStats';
import { periodTime } from './trendAxis';

export const KZ_PLR_SHORT: Record<string, string> = {
  '08100102': 'Schiller. N',
  '08100103': 'Schiller. S',
  '08100104': 'Warthepl.',
  '08100105': 'Silberst.',
};

export const KZ_SERIES_COLORS: Record<string, string> = {
  all: '#6b8a4a',
  '08100102': '#3f8f9f',
  '08100103': '#b23a5b',
  '08100104': '#e8a53a',
  '08100105': '#6f2f59',
};

const AGE_LABELS = ['0–5', '6–17', '18–26', '27–44', '45–54', '55–64', '65+'];

// Old LOR → new LOR mapping for continuous social trend lines across the
// 2021 planning-area reform boundary. Port of KiezDashboard.svelte:106-109.
const SOCIAL_PLR_GROUPS: { name: string; old: string; new: string[] }[] = [
  { name: 'Schillerpromenade', old: '08010117', new: ['08100102', '08100103'] },
  { name: 'Silbersteinstraße', old: '08010118', new: ['08100104', '08100105'] },
];

export function periodLabel(period: string): string {
  const m = period.match(/^(\d{4})h([12])$/);
  if (m) return `H${m[2]} '${m[1].slice(2)}`;
  return `'${period.slice(2)}`;
}

const fmtDelta = (curr: number, prev: number): string => {
  const d = curr - prev;
  return d >= 0 ? `+${d}` : `−${Math.abs(d)}`; // U+2212 minus
};

function formatStand(lastUpdated: string): string {
  const [y, m, d] = lastUpdated.split('-');
  return `${d}.${m}.${y}`;
}

function pctOf(x: number, total: number): number {
  return total ? Math.round((x / total) * 1000) / 10 : 0;
}

export interface KzAreaVM {
  code: string; // 'all' | PLR code
  name: string;
  short: string;
  pop: number;
  male: number;
  female: number;
  singlePerson: number; // 0 today — UI hides when falsy
  delta: string | null; // e.g. "+180", "−40" (U+2212 for minus), null when <2 trend points
  deltaVsLabel: string | null; // previous period label, e.g. "H2 '24"
  agePct: number[]; // 7 groups, percentages
  ageAbs: number[]; // 7 groups, counts
  mig: { a: number; mh: number; o: number } | null; // non-overlapping percentages (1 decimal)
  social: { alq: number; ka: number; tr: number; status: number; dyn: number; dynClass: DynamikClass | null } | null;
  trend: { label: string; value: number; t: number }[]; // population per period, "H2 '21" labels; t = reference date as fractional year (trendAxis.periodTime) — charts place points by t, never by index
}

export interface KiezVM {
  stand: string; // dd.mm.yyyy from lastUpdated
  lastUpdated: string;
  ageLabels: string[]; // ['0–5','6–17','18–26','27–44','45–54','55–64','65+']
  areas: KzAreaVM[]; // [0] = 'all' aggregate, then the 4 PLRs in code order
  divTrend: { label: string; a: number; mh: number; o: number; t: number }[]; // Gesamt diversity % over periods (t: see trend)
  socialPeriod: string | null; // raw latest MSS period, e.g. "2023" (Kanal 04 right meta "MSS 2023")
  socTrend: {
    years: string[]; // "'13" … "'23"
    gesamt: { alq: number[]; ka: number[]; tr: number[] };
    series: { name: string; alq: (number | null)[] }[]; // merged LOR series, aligned to years
    reformBeforeIndex: number; // index of first year >= 2021 (boundary marker sits before it)
  } | null;
}

type MigCounts = { foreignNationals: number; germanWithMigBg: number; withoutMigBg: number; totalPopulation: number };
type SocialCounts = {
  unemploymentRate: number;
  childPovertyRate: number;
  transferBenefitRate: number;
  statusIndex: number;
  dynamikIndex: number;
  dynamikClass?: DynamikClass | null;
} | null;

function buildArea(
  code: string,
  name: string,
  short: string,
  population: { total: number; male: number; female: number },
  ageDistribution: AgeDistributionEntry[],
  migration: MigCounts,
  singlePerson: number,
  social: SocialCounts,
  trendPoints: { period: string; population: number }[]
): KzAreaVM {
  const trend = trendPoints.map((p) => ({ label: periodLabel(p.period), value: p.population, t: periodTime(p.period) }));
  let delta: string | null = null;
  let deltaVsLabel: string | null = null;
  if (trend.length >= 2) {
    const last = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    delta = fmtDelta(last.value, prev.value);
    deltaVsLabel = prev.label;
  }

  const mig = migration.totalPopulation
    ? {
        a: pctOf(migration.foreignNationals, migration.totalPopulation),
        mh: pctOf(migration.germanWithMigBg, migration.totalPopulation),
        o: pctOf(migration.withoutMigBg, migration.totalPopulation),
      }
    : null;

  return {
    code,
    name,
    short,
    pop: population.total,
    male: population.male,
    female: population.female,
    singlePerson,
    delta,
    deltaVsLabel,
    agePct: ageDistribution.map((e) => e.percentage),
    ageAbs: ageDistribution.map((e) => e.count),
    mig,
    social: social
      ? {
          alq: social.unemploymentRate,
          ka: social.childPovertyRate,
          tr: social.transferBenefitRate,
          status: social.statusIndex,
          dyn: social.dynamikIndex,
          dynClass: social.dynamikClass ?? null,
        }
      : null,
    trend,
  };
}

function buildDivTrend(trend: KiezStatsResponse['trend']): { label: string; a: number; mh: number; o: number; t: number }[] {
  return trend.map((t) => {
    const sum = t.foreignNationals + t.germanWithMigBg + t.withoutMigBg;
    return {
      label: periodLabel(t.period),
      t: periodTime(t.period),
      a: pctOf(t.foreignNationals, sum),
      mh: pctOf(t.germanWithMigBg, sum),
      o: pctOf(t.withoutMigBg, sum),
    };
  });
}

function buildSocTrend(
  socialTrend: KiezStatsResponse['socialTrend'],
  plrSocialTrend: KiezStatsResponse['plrSocialTrend']
): KiezVM['socTrend'] {
  if (socialTrend.length < 2) return null;

  const years = socialTrend.map((s) => periodLabel(s.period));
  const gesamt = {
    alq: socialTrend.map((s) => s.unemploymentRate),
    ka: socialTrend.map((s) => s.childPovertyRate),
    tr: socialTrend.map((s) => s.transferBenefitRate),
  };

  const series = SOCIAL_PLR_GROUPS.map((group) => {
    const alq = socialTrend.map((s) => {
      const periodNum = parseInt(s.period, 10);
      const codes = periodNum < 2021 ? [group.old] : group.new;
      const vals = plrSocialTrend.filter((d) => codes.includes(d.plr_code) && d.period === s.period);
      if (vals.length === 0) return null;
      const n = vals.length;
      return Math.round((vals.reduce((sum, v) => sum + v.unemploymentRate, 0) / n) * 10) / 10;
    });
    return { name: group.name, alq };
  });

  let reformBeforeIndex = socialTrend.findIndex((s) => parseInt(s.period, 10) >= 2021);
  if (reformBeforeIndex === -1) reformBeforeIndex = socialTrend.length;

  return { years, gesamt, series, reformBeforeIndex };
}

export function buildKiezViewModel(stats: KiezStatsResponse): KiezVM {
  const demo = stats.demographics;
  if (!demo) throw new Error('buildKiezViewModel requires stats.demographics to be present');

  const allTrendPoints = stats.trend.map((t) => ({ period: t.period, population: t.population }));
  const allArea = buildArea(
    'all',
    'Gesamt · Schillerkiez',
    'Gesamt',
    demo.population,
    demo.ageDistribution,
    demo.migration,
    demo.households.singlePerson,
    stats.social,
    allTrendPoints
  );

  const plrAreas: PlrAreaDetail[] = [...stats.plrAreas].sort((a, b) => a.code.localeCompare(b.code));
  const plrAreaVMs = plrAreas.map((p) => {
    const trendPoints = stats.plrTrend
      .filter((t) => t.plr_code === p.code)
      .map((t) => ({ period: t.period, population: t.population }));
    return buildArea(p.code, p.name, KZ_PLR_SHORT[p.code] ?? p.code, p.population, p.ageDistribution, p.migration, 0, p.social, trendPoints);
  });

  return {
    stand: formatStand(stats.lastUpdated),
    lastUpdated: stats.lastUpdated,
    ageLabels: AGE_LABELS,
    areas: [allArea, ...plrAreaVMs],
    divTrend: buildDivTrend(stats.trend),
    socialPeriod: stats.socialTrend.length ? stats.socialTrend[stats.socialTrend.length - 1].period : null,
    socTrend: buildSocTrend(stats.socialTrend, stats.plrSocialTrend),
  };
}
