import type { APIRoute } from 'astro';
import type { AirQualityResponse } from '../../types/kiezStats';
import { fetchBlumeAll, pickAirSource, FALLBACK_STATION, PRIMARY_STATION_NAME } from '../../lib/kiez/blume';

const POLLUTANT_NAMES: Record<string, string> = {
  pm10: 'PM10',
  no2: 'NO₂',
  o3: 'O₃',
  co: 'CO',
};

const GRADE_LABELS = ['', 'sehr gut', 'gut', 'mäßig', 'schlecht', 'sehr schlecht'];

export const GET: APIRoute = async () => {
  try {
    // mc042 when it has a value; else the labelled Karl-Marx-Straße substitute; else 502 → the strip's „Kein Signal" state.
    const pick = pickAirSource(await fetchBlumeAll());
    const data = pick?.data ?? [];

    const lqi = data.find((d) => d.component === 'lqi');
    if (!pick || !lqi || lqi.grade == null) {
      return new Response(JSON.stringify({ error: 'No LQI data for mc042' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pollutants = data
      .filter((d) => d.component !== 'lqi' && d.component in POLLUTANT_NAMES)
      .map((d) => ({
        name: POLLUTANT_NAMES[d.component] ?? d.component.toUpperCase(),
        component: d.component,
        grade: d.grade,
        gradeLabel: d.grade != null ? (GRADE_LABELS[d.grade] ?? '') : 'keine Angabe',
      }));

    const response: AirQualityResponse = {
      station: pick.station,
      stationName: pick.source === 'substitute' ? FALLBACK_STATION.name : PRIMARY_STATION_NAME,
      datetime: lqi.datetime,
      overallGrade: lqi.grade,
      overallLabel: GRADE_LABELS[lqi.grade] ?? '',
      pollutants,
      ...(pick.source === 'substitute'
        ? { substitute: { kind: FALLBACK_STATION.kind, distanceKm: FALLBACK_STATION.distanceKm, primaryStationName: PRIMARY_STATION_NAME } }
        : {}),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('kiez-air API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch air quality data' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
