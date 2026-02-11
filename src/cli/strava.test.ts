import { describe, expect, it, vi } from 'vitest';
import { fetchRunSummaries, isRunActivity, type StravaApiClient, type StravaSummaryActivity } from './strava.js';

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
    };

    const result = await fetchRunSummaries(client, { perPage: 2 });

    expect(result.runs.map((item) => item.id)).toEqual([1, 3]);
    expect(result.skippedNonRun).toBe(1);
    expect(result.pagesFetched).toBe(3);
    expect(getActivitiesPage).toHaveBeenCalledTimes(3);
  });
});
