/** MongoDB document for AfS demographics (per PLR, per period) */
export type DynamikClass = 'positiv' | 'stabil' | 'negativ';

export interface KiezDemographicsDoc {
  plr_code: string;
  plr_name: string;
  period: string; // e.g. "2025h2"
  date: string; // e.g. "2025-12-31"
  population: {
    total: number;
    male: number;
    female: number;
  };
  age_groups: {
    u6: number;   // 0–5
    u18: number;  // 6–17
    u27: number;  // 18–26
    u45: number;  // 27–44
    u55: number;  // 45–54
    u65: number;  // 55–64
    a65: number;  // 65+
  };
  migration: {
    foreign_nationals: number; // AUSL
    migration_background: number; // MH (includes AUSL)
  };
  households: {
    single_person: number; // E_E
  };
}

/** MongoDB document for MSS social index (per PLR, per report period) */
export interface KiezSocialDoc {
  plr_code: string;
  plr_name: string;
  period: string; // e.g. "2023"
  unemployment_rate: number;
  child_poverty_rate: number;
  transfer_benefit_rate: number;
  status_index: number;
  /** +1 / 0 / -1 from the MSS Dynamik class sign; 0 also for legacy rows synced before 2026-09-09. */
  dynamik_index: number;
  /** MSS Dynamik-Index class; absent on legacy rows (re-sync to populate). */
  dynamik_class?: DynamikClass;
  /** 2023+ only: S2 — share of children in single-parent households (NOT poverty). Pre-2023 S2 (Langzeitarbeitslose) is not stored. */
  single_parent_children_rate?: number;
}

/** MongoDB doc in `schillerkiez_reference` — Berlin/Neukölln yardstick figures for the Berlin-Vergleich module (novel §02). Imported per MSS period from the Bezirke-level share table; strictly 1:1 per period, never back-filled. */
export interface KiezReferenceDoc {
  scope: 'berlin' | 'neukoelln';
  period: string; // MSS period, e.g. "2023"
  date: string;   // `${period}-12-31`
  unemployment_rate: number;
  child_poverty_rate: number;
  transfer_benefit_rate: number;
  /** 'bezirk_row' (Neukölln, read directly) | 'ew_weighted_mean_of_bezirke' (Berlin — the file has no Berlin row; weighted by residents, an approximation of the true city rate) */
  derivation: string;
}

/** Age distribution entry in API response */
export interface AgeDistributionEntry {
  group: string;
  key: string;
  count: number;
  percentage: number;
}

/** Per-PLR area detail (demographics + social) */
export interface PlrAreaDetail {
  code: string;
  name: string;
  population: { total: number; male: number; female: number };
  ageDistribution: AgeDistributionEntry[];
  migration: {
    foreignNationals: number;
    germanWithMigBg: number;
    withoutMigBg: number;
    totalPopulation: number;
  };
  social: {
    unemploymentRate: number;
    childPovertyRate: number;
    transferBenefitRate: number;
    statusIndex: number;
    dynamikIndex: number;
    /** null until the social data has been re-synced with the class-aware importer. */
    dynamikClass?: DynamikClass | null;
  } | null;
}

/** Aggregated API response */
export interface KiezStatsResponse {
  lastUpdated: string;
  source: string;
  demographics: {
    population: { total: number; male: number; female: number };
    ageDistribution: AgeDistributionEntry[];
    migration: {
      foreignNationals: number;
      germanWithMigBg: number;
      withoutMigBg: number;
      totalPopulation: number;
    };
    households: { singlePerson: number };
  } | null;
  social: {
    unemploymentRate: number;
    childPovertyRate: number;
    transferBenefitRate: number;
    statusIndex: number;
    dynamikIndex: number;
    /** null until the social data has been re-synced with the class-aware importer. */
    dynamikClass?: DynamikClass | null;
  } | null;
  plrAreas: PlrAreaDetail[];
  trend: Array<{
    period: string;
    date: string;
    population: number;
    foreignNationals: number;
    germanWithMigBg: number;
    withoutMigBg: number;
  }>;
  plrTrend: Array<{
    plr_code: string;
    plr_name: string;
    period: string;
    date: string;
    population: number;
  }>;
  socialTrend: Array<{
    period: string;
    date: string;
    unemploymentRate: number;
    childPovertyRate: number;
    transferBenefitRate: number;
  }>;
  plrSocialTrend: Array<{
    plr_code: string;
    plr_name: string;
    period: string;
    date: string;
    unemploymentRate: number;
    childPovertyRate: number;
    transferBenefitRate: number;
  }>;
  /** Berlin/Neukölln yardstick for the SAME period as `social` (novel §02). Omitted when absent — the Berlin-Vergleich module is then quietly absent, like air. */
  reference?: {
    period: string;
    berlin: {
      unemploymentRate: number;
      childPovertyRate: number;
      transferBenefitRate: number;
    } | null;
    neukoelln: {
      unemploymentRate: number;
      childPovertyRate: number;
      transferBenefitRate: number;
    } | null;
  };
}

/** BLUME air quality — single pollutant grade */
export interface AirQualityPollutant {
  name: string;         // "PM10", "NO₂", "O₃", "CO"
  component: string;    // "pm10", "no2", "o3", "co"
  grade: number | null;  // 1–5, null when station has no current reading
  gradeLabel: string;   // "sehr gut" | "gut" | "mäßig" | "schlecht" | "sehr schlecht" | "k.A."
}

/** BLUME air quality — full response from /api/kiez-air */
export interface AirQualityResponse {
  station: string;      // "mc042"
  stationName: string;  // "Nansenstraße"
  datetime: string;     // ISO timestamp of measurement
  overallGrade: number; // 1–5 (from "lqi" component)
  overallLabel: string; // German label
  pollutants: AirQualityPollutant[];
  /** Present ONLY when the values come from the substitute station because mc042 has no measurement (2026-09-20). `station`/`stationName` then name the substitute. */
  substitute?: {
    kind: 'traffic';
    distanceKm: number;
    primaryStationName: string; // the silent station, for the note
  };
}

/** MongoDB doc in `schillerkiez_air_log` — one BLUME reading (logger runs every 30 min; BLUME publishes hourly, duplicates are dropped on the unique `ts`). Hourly rows are pruned after 90 days. */
export interface AirLogDoc {
  ts: Date;            // BLUME measurement timestamp (unique key)
  day: string;         // "YYYY-MM-DD" Europe/Berlin calendar day of `ts`
  lqi: number;         // overall LQI grade 1–5
  pm10: number | null; // pollutant grades 1–5, null = no current reading
  no2: number | null;
  o3: number | null;
  co: number | null;
  loggedAt: Date;      // when the logger wrote the doc
}

/** MongoDB doc in `schillerkiez_air_daily` — per-Berlin-day rollup, kept forever. Only ever written for days that HAVE readings (gaps stay absent — never interpolated). */
export interface AirDailyDoc {
  day: string;     // "YYYY-MM-DD" Europe/Berlin (unique key)
  lqiMax: number;
  lqiMean: number; // rounded to 0.1
  readings: number;
  updatedAt: Date;
}

/** One slot of the 7-day strip served by GET /api/kiez-air-history */
export interface AirHistoryDay {
  day: string;           // "YYYY-MM-DD" Europe/Berlin
  lqiMax: number | null; // null = no readings logged that day → render dashed empty bar
  lqiMean: number | null;
  readings: number;
}

/** GET /api/kiez-air-history response — Mongo only, independent of live BLUME */
export interface AirHistoryResponse {
  days: AirHistoryDay[]; // exactly 7, oldest first, last entry = today (Europe/Berlin)
  lastReading: { ts: string; lqi: number } | null; // latest logged reading (ISO ts), for state §04
}
