import { describe, expect, it, vi } from 'vitest';
import {
  fetchRunSummaries,
  isRunActivity,
  toPersistedHeartRateZones,
  toPersistedTrendPoints,
  type StravaApiClient,
  type StravaSummaryActivity,
} from './strava.js';

describe('isRunActivity', () => {
  it('accepts sport_type Run', () => {
    expect(isRunActivity({ sport_type: 'Run' })).toBe(true);
  });

  it('accepts legacy type Run', () => {
    expect(isRunActivity({ type: 'Run' })).toBe(true);
  });

  it('rejects non run', () => {
    expect(isRunActivity({ sport_type: 'Ride' })).toBe(false);
  });
});

describe('fetchRunSummaries', () => {
  it('paginates until empty page and filters non-run', async () => {
    const pages: StravaSummaryActivity[][] = [
      [
        { id: 1, name: 'run-1', sport_type: 'Run', start_date_local: '2026-01-01T08:00:00Z' },
        { id: 2, name: 'ride-1', sport_type: 'Ride', start_date_local: '2026-01-02T08:00:00Z' },
      ],
      [{ id: 3, name: 'run-2', type: 'Run', start_date_local: '2026-01-03T08:00:00Z' }],
      [],
    ];

    const getActivitiesPage = vi.fn(async (page: number) => pages[page - 1] ?? []);
    const client: StravaApiClient = {
      getActivitiesPage,
      getActivityById: vi.fn(),
      getActivityZonesById: vi.fn(),
      getActivityStreamsById: vi.fn(),
    };

    const result = await fetchRunSummaries(client, { perPage: 2 });

    expect(result.runs.map((item) => item.id)).toEqual([1, 3]);
    expect(result.skippedNonRun).toBe(1);
    expect(result.pagesFetched).toBe(3);
    expect(getActivitiesPage).toHaveBeenCalledTimes(3);
  });
});

describe('toPersistedTrendPoints', () => {
  it('maps and downsamples stream data for detail charts', () => {
    const size = 400;
    const points = toPersistedTrendPoints({
      time: { data: Array.from({ length: size }, (_, index) => index) },
      distance: { data: Array.from({ length: size }, (_, index) => index * 4.2) },
      heartrate: { data: Array.from({ length: size }, (_, index) => 130 + (index % 40)) },
      velocity_smooth: { data: Array.from({ length: size }, (_, index) => 2.5 + (index % 10) * 0.08) },
    });

    expect(points.length).toBeLessThanOrEqual(220);
    expect(points[0].elapsedTimeS).toBe(0);
    expect(points.at(-1)?.elapsedTimeS).toBe(size - 1);
    expect(points[0].paceSecPerKm).not.toBeNull();
  });
});

describe('toPersistedHeartRateZones', () => {
  it('maps heartrate buckets to normalized zones', () => {
    const zones = toPersistedHeartRateZones([
      {
        type: 'heartrate',
        distribution_buckets: [
          { min: 0, max: 121, time: 60 },
          { min: 122, max: 151, time: 120 },
          { min: 152, max: 166, time: 180 },
          { min: 167, max: 180, time: 240 },
          { min: 181, max: -1, time: 30 },
        ],
      },
    ]);

    expect(zones).toHaveLength(5);
    expect(zones[0]).toMatchObject({ zone: 'Z1', minBpm: 0, maxBpm: 121, timeS: 60 });
    expect(zones[4]).toMatchObject({ zone: 'Z5', minBpm: 181, maxBpm: null, timeS: 30 });
    expect(zones.reduce((sum, zone) => sum + (zone.percentage ?? 0), 0)).toBeCloseTo(1, 5);
  });
});
