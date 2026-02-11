import { paceFromDistanceAndTime, speedToPace } from '../shared/units.js';
import type { PersistedActivity, PersistedHeartRateZone, PersistedSplit, PersistedTrendPoint } from '../db/repository.js';

export interface StravaSummaryActivity {
  id: number;
  name: string;
  device_name?: string;
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
  average_heartrate?: number;
  average_cadence?: number;
  calories?: number;
}

export interface StravaDetailedActivity {
  id: number;
  name: string;
  device_name?: string;
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
  calories?: number;
  suffer_score?: number;
  map?: {
    summary_polyline?: string;
    polyline?: string;
  };
  splits_metric?: StravaSplit[];
}

export interface StravaZoneBucket {
  min?: number;
  max?: number;
  time?: number;
}

export interface StravaActivityZone {
  type?: string;
  max?: number;
  distribution_buckets?: StravaZoneBucket[];
}

export interface StravaStreamValue {
  data?: number[];
}

export interface StravaTypedStream {
  type?: string;
  data?: number[];
}

export interface StravaActivityStreams {
  time?: StravaStreamValue;
  distance?: StravaStreamValue;
  heartrate?: StravaStreamValue;
  velocity_smooth?: StravaStreamValue;
}

export type StravaActivityStreamsPayload = StravaActivityStreams | StravaTypedStream[];

export interface StravaApiClient {
  getActivitiesPage(page: number, perPage: number, afterEpoch?: number): Promise<StravaSummaryActivity[]>;
  getActivityById(id: number): Promise<StravaDetailedActivity>;
  getActivityZonesById(id: number): Promise<StravaActivityZone[]>;
  getActivityStreamsById(id: number): Promise<StravaActivityStreamsPayload>;
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

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDate = Date.parse(value);
  if (Number.isNaN(asDate)) {
    return null;
  }

  return Math.max(0, asDate - Date.now());
}

function msUntilNextQuarterHour(nowMs = Date.now()): number {
  const quarterMs = 15 * 60 * 1000;
  return quarterMs - (nowMs % quarterMs);
}

function msUntilNextUtcDay(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const nextUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, nextUtcMidnightMs - nowMs);
}

function computeRateLimitWaitMs(limit: { short: number; long: number } | null, usage: { short: number; long: number } | null): number {
  if (!limit || !usage) {
    return 0;
  }

  if (usage.long >= limit.long) {
    // Daily budget exhausted, next reset is at UTC midnight.
    return msUntilNextUtcDay() + 5_000;
  }

  if (usage.short >= limit.short) {
    // 15-min bucket exhausted, wait until next quarter.
    return msUntilNextQuarterHour() + 2_000;
  }

  return 0;
}

function formatWaitMs(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }

  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}m ${seconds}s`;
}

async function fetchWithRetry<T>(url: URL, token: string, attempt = 1): Promise<T> {
  const maxAttempts = 20;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const limit =
    parseRateHeader(response.headers.get('x-ratelimit-limit')) ?? parseRateHeader(response.headers.get('x-readratelimit-limit'));
  const usage =
    parseRateHeader(response.headers.get('x-ratelimit-usage')) ?? parseRateHeader(response.headers.get('x-readratelimit-usage'));

  if (response.status === 429 || response.status >= 500) {
    if (attempt >= maxAttempts) {
      throw new Error(`Strava API failed after retries: ${response.status} ${response.statusText}`);
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? 0;
    const rateLimitWaitMs = response.status === 429 ? computeRateLimitWaitMs(limit, usage) : 0;
    const exponentialBackoffMs = Math.min(2_000 * 2 ** (attempt - 1), 60_000);
    const waitMs = Math.max(retryAfterMs, rateLimitWaitMs, exponentialBackoffMs);

    if (response.status === 429) {
      console.warn(`Strava API hit rate limit (429). Waiting ${formatWaitMs(waitMs)} before retry #${attempt + 1}.`);
    }

    await sleep(waitMs);
    return fetchWithRetry<T>(url, token, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava API request failed: ${response.status} ${response.statusText} ${text}`);
  }

  if (limit && usage) {
    const shortRemaining = limit.short - usage.short;
    if (shortRemaining <= 2) {
      await sleep(3_000);
    }
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

    async getActivityZonesById(id: number): Promise<StravaActivityZone[]> {
      const url = new URL(`${BASE_URL}/activities/${id}/zones`);
      return fetchWithRetry<StravaActivityZone[]>(url, token);
    },

    async getActivityStreamsById(id: number): Promise<StravaActivityStreamsPayload> {
      const url = new URL(`${BASE_URL}/activities/${id}/streams`);
      url.searchParams.set('keys', 'time,distance,heartrate,velocity_smooth');
      url.searchParams.set('key_by_type', 'true');
      return fetchWithRetry<StravaActivityStreamsPayload>(url, token);
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

function normalizeZoneMaxBpm(max: number | null, min: number): number | null {
  if (max == null) {
    return null;
  }
  if (!Number.isFinite(max) || max <= 0) {
    return null;
  }
  if (max < min) {
    return null;
  }
  return Math.round(max);
}

export function toPersistedHeartRateZones(activityZones: StravaActivityZone[] | undefined): PersistedHeartRateZone[] {
  if (!activityZones || activityZones.length === 0) {
    return [];
  }

  const heartRateZones =
    activityZones.find((zone) => zone.type === 'heartrate' && Array.isArray(zone.distribution_buckets)) ??
    activityZones.find((zone) => Array.isArray(zone.distribution_buckets));

  if (!heartRateZones || !heartRateZones.distribution_buckets || heartRateZones.distribution_buckets.length === 0) {
    return [];
  }

  const buckets = heartRateZones.distribution_buckets;
  const totalTimeS = buckets.reduce((sum, bucket) => {
    const value = Number(bucket.time ?? 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);

  return buckets.map((bucket, index) => {
    const min = Number.isFinite(Number(bucket.min)) ? Math.max(0, Number(bucket.min)) : 0;
    const max = Number(bucket.max);
    const timeSRaw = Number(bucket.time ?? 0);
    const timeS = Number.isFinite(timeSRaw) && timeSRaw > 0 ? Math.round(timeSRaw) : 0;
    return {
      zone: `Z${index + 1}`,
      minBpm: Math.round(min),
      maxBpm: normalizeZoneMaxBpm(max, min),
      timeS,
      percentage: totalTimeS > 0 ? timeS / totalTimeS : null,
    };
  });
}

function toNumericSeries(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function downsampleTrendPoints(points: PersistedTrendPoint[], maxPoints: number): PersistedTrendPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampled: PersistedTrendPoint[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  const used = new Set<number>();

  for (let index = 0; index < maxPoints; index += 1) {
    const raw = Math.round(index * step);
    const clamped = Math.min(points.length - 1, Math.max(0, raw));
    if (used.has(clamped)) {
      continue;
    }
    used.add(clamped);
    sampled.push(points[clamped]);
  }

  if (sampled[0] !== points[0]) {
    sampled.unshift(points[0]);
  }
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }

  return sampled.sort((a, b) => a.elapsedTimeS - b.elapsedTimeS);
}

function normalizeStreamPayload(payload: StravaActivityStreamsPayload): StravaActivityStreams {
  if (Array.isArray(payload)) {
    const normalized: StravaActivityStreams = {};
    for (const stream of payload) {
      if (!stream?.type || !Array.isArray(stream.data)) {
        continue;
      }
      if (stream.type === 'time' || stream.type === 'distance' || stream.type === 'heartrate' || stream.type === 'velocity_smooth') {
        normalized[stream.type] = { data: stream.data };
      }
    }
    return normalized;
  }
  return payload;
}

export function toPersistedTrendPoints(streamsPayload: StravaActivityStreamsPayload | undefined): PersistedTrendPoint[] {
  if (!streamsPayload) {
    return [];
  }

  const streams = normalizeStreamPayload(streamsPayload);

  const time = toNumericSeries(streams.time?.data);
  const distance = toNumericSeries(streams.distance?.data);
  const heartrate = toNumericSeries(streams.heartrate?.data);
  const velocity = toNumericSeries(streams.velocity_smooth?.data);

  const length = Math.max(time.length, distance.length, heartrate.length, velocity.length);
  if (length === 0) {
    return [];
  }

  const points: PersistedTrendPoint[] = [];
  for (let index = 0; index < length; index += 1) {
    const elapsedTimeS = time[index];
    if (!Number.isFinite(elapsedTimeS) || elapsedTimeS < 0) {
      continue;
    }

    const rawDistance = distance[index];
    const distanceM = Number.isFinite(rawDistance) ? rawDistance : null;
    const rawHeartrate = heartrate[index];
    const heartrateValue = Number.isFinite(rawHeartrate) ? rawHeartrate : null;
    const rawVelocity = velocity[index];
    const paceSecPerKm = Number.isFinite(rawVelocity) && rawVelocity > 0 ? speedToPace(rawVelocity) : null;

    if (heartrateValue == null && paceSecPerKm == null) {
      continue;
    }

    points.push({
      elapsedTimeS: Math.round(elapsedTimeS),
      distanceM: distanceM == null ? null : Number(distanceM),
      paceSecPerKm: paceSecPerKm == null ? null : Number(paceSecPerKm),
      heartrate: heartrateValue == null ? null : Number(heartrateValue),
    });
  }

  if (points.length === 0) {
    return [];
  }

  points.sort((a, b) => a.elapsedTimeS - b.elapsedTimeS);
  return downsampleTrendPoints(points, 220);
}

export function toPersistedActivity(
  detail: StravaDetailedActivity,
  activityZones?: StravaActivityZone[],
  streams?: StravaActivityStreamsPayload,
): PersistedActivity {
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
      averageHeartrate: split.average_heartrate == null ? null : Number(split.average_heartrate),
      averageCadence: split.average_cadence == null ? null : Number(split.average_cadence),
      calories: split.calories == null ? null : Number(split.calories),
    };
  });
  const heartRateZones = toPersistedHeartRateZones(activityZones);
  const trendPoints = toPersistedTrendPoints(streams);

  return {
    stravaId: detail.id,
    name: detail.name,
    deviceName: detail.device_name ?? null,
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
    calories: detail.calories == null ? null : Number(detail.calories),
    sufferScore: detail.suffer_score == null ? null : Number(detail.suffer_score),
    mapSummaryPolyline: detail.map?.summary_polyline ?? null,
    mapPolyline: detail.map?.polyline ?? null,
    heartRateZones,
    trendPoints,
    rawJson: JSON.stringify(detail),
    splits,
  };
}
