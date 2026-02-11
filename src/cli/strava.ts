import { paceFromDistanceAndTime, speedToPace } from '../shared/units.js';
import type { PersistedActivity, PersistedSplit } from '../db/repository.js';

export interface StravaSummaryActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date_local: string;
}

export interface StravaSplit {
  split: number;
  distance?: number;
  elapsed_time?: number;
  elevation_difference?: number;
  average_speed?: number;
}

export interface StravaDetailedActivity {
  id: number;
  name: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  suffer_score?: number;
  map?: {
    summary_polyline?: string;
    polyline?: string;
  };
  splits_metric?: StravaSplit[];
}

export interface StravaApiClient {
  getActivitiesPage(page: number, perPage: number, afterEpoch?: number): Promise<StravaSummaryActivity[]>;
  getActivityById(id: number): Promise<StravaDetailedActivity>;
}

export interface FetchRunSummariesResult {
  runs: StravaSummaryActivity[];
  skippedNonRun: number;
  pagesFetched: number;
}

const BASE_URL = 'https://www.strava.com/api/v3';

export function isRunActivity(activity: { sport_type?: string; type?: string }): boolean {
  return activity.sport_type === 'Run' || activity.type === 'Run';
}

function parseRateHeader(headerValue: string | null): { short: number; long: number } | null {
  if (!headerValue) {
    return null;
  }

  const [shortRaw, longRaw] = headerValue.split(',').map((entry) => Number(entry.trim()));
  if (!Number.isFinite(shortRaw) || !Number.isFinite(longRaw)) {
    return null;
  }

  return { short: shortRaw, long: longRaw };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(url: URL, token: string, attempt = 1): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const limit = parseRateHeader(response.headers.get('x-ratelimit-limit'));
  const usage = parseRateHeader(response.headers.get('x-ratelimit-usage'));

  if (limit && usage) {
    const shortRemaining = limit.short - usage.short;
    if (shortRemaining <= 3) {
      const backoffMs = 4000;
      await sleep(backoffMs);
    }
  }

  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 5) {
      throw new Error(`Strava API failed after retries: ${response.status} ${response.statusText}`);
    }

    const backoffMs = Math.min(2000 * attempt, 10000);
    await sleep(backoffMs);
    return fetchWithRetry<T>(url, token, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava API request failed: ${response.status} ${response.statusText} ${text}`);
  }

  return (await response.json()) as T;
}

export function createStravaApiClient(token: string): StravaApiClient {
  return {
    async getActivitiesPage(page: number, perPage: number, afterEpoch?: number): Promise<StravaSummaryActivity[]> {
      const url = new URL(`${BASE_URL}/athlete/activities`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      if (afterEpoch) {
        url.searchParams.set('after', String(afterEpoch));
      }
      return fetchWithRetry<StravaSummaryActivity[]>(url, token);
    },

    async getActivityById(id: number): Promise<StravaDetailedActivity> {
      const url = new URL(`${BASE_URL}/activities/${id}`);
      return fetchWithRetry<StravaDetailedActivity>(url, token);
    },
  };
}

export async function fetchRunSummaries(
  client: StravaApiClient,
  options: { afterEpoch?: number; perPage?: number } = {},
): Promise<FetchRunSummariesResult> {
  const perPage = options.perPage ?? 100;
  let page = 1;
  let pagesFetched = 0;
  let skippedNonRun = 0;
  const runs: StravaSummaryActivity[] = [];

  while (true) {
    const pageActivities = await client.getActivitiesPage(page, perPage, options.afterEpoch);
    pagesFetched += 1;

    if (pageActivities.length === 0) {
      break;
    }

    for (const activity of pageActivities) {
      if (isRunActivity(activity)) {
        runs.push(activity);
      } else {
        skippedNonRun += 1;
      }
    }

    page += 1;
  }

  return {
    runs,
    skippedNonRun,
    pagesFetched,
  };
}

export function toPersistedActivity(detail: StravaDetailedActivity): PersistedActivity {
  const splits: PersistedSplit[] = (detail.splits_metric ?? []).map((split) => {
    const distanceM = Number(split.distance ?? 0);
    const elapsedTimeS = Number(split.elapsed_time ?? 0);
    return {
      splitIndex: Number(split.split),
      distanceM,
      elapsedTimeS,
      elevationDifferenceM: split.elevation_difference == null ? null : Number(split.elevation_difference),
      averageSpeedMps: split.average_speed == null ? null : Number(split.average_speed),
      paceSecPerKm:
        split.average_speed != null ? speedToPace(Number(split.average_speed)) : paceFromDistanceAndTime(distanceM, elapsedTimeS),
    };
  });

  return {
    stravaId: detail.id,
    name: detail.name,
    startDateLocal: detail.start_date_local,
    distanceM: Number(detail.distance),
    movingTimeS: Number(detail.moving_time),
    elapsedTimeS: Number(detail.elapsed_time),
    totalElevationGainM: Number(detail.total_elevation_gain ?? 0),
    averageSpeedMps: detail.average_speed == null ? null : Number(detail.average_speed),
    maxSpeedMps: detail.max_speed == null ? null : Number(detail.max_speed),
    averageHeartrate: detail.average_heartrate == null ? null : Number(detail.average_heartrate),
    maxHeartrate: detail.max_heartrate == null ? null : Number(detail.max_heartrate),
    averageCadence: detail.average_cadence == null ? null : Number(detail.average_cadence),
    sufferScore: detail.suffer_score == null ? null : Number(detail.suffer_score),
    mapSummaryPolyline: detail.map?.summary_polyline ?? null,
    mapPolyline: detail.map?.polyline ?? null,
    rawJson: JSON.stringify(detail),
    splits,
  };
}
