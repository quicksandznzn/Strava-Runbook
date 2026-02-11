import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

function createResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders summary cards and activity row', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 1,
          totalDistanceM: 10000,
          totalMovingTimeS: 3600,
          totalElevationGainM: 100,
          averagePaceSecPerKm: 360,
          bestPaceSecPerKm: 340,
          averageHeartrate: 150,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([
          {
            weekStart: '2026-01-01',
            totalDistanceM: 10000,
            totalMovingTimeS: 3600,
            averagePaceSecPerKm: 360,
            runs: 1,
          },
        ]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [1],
          },
        });
      }
      if (url.startsWith('/api/activities/1/analysis')) {
        return createErrorResponse(404, { error: 'No analysis yet for this activity.' });
      }
      if (url.startsWith('/api/activities/1')) {
        return createResponse({
          stravaId: 1,
          name: 'Morning Run',
          startDateLocal: '2026-01-01T08:00:00Z',
          distanceM: 10000,
          movingTimeS: 3600,
          elapsedTimeS: 3660,
          totalElevationGainM: 100,
          averageSpeedMps: 2.7,
          maxSpeedMps: 4,
          paceSecPerKm: 360,
          averageHeartrate: 150,
          maxHeartrate: 170,
          athleteMaxHeartrate: 186,
          averageCadence: 80,
          sufferScore: 50,
          mapSummaryPolyline: null,
          mapPolyline: null,
          updatedAt: '2026-01-01T09:00:00Z',
          trendPoints: [
            { elapsedTimeS: 60, distanceM: 250, paceSecPerKm: 342, heartrate: 144 },
            { elapsedTimeS: 120, distanceM: 520, paceSecPerKm: 336, heartrate: 148 },
            { elapsedTimeS: 180, distanceM: 800, paceSecPerKm: 333, heartrate: 151 },
          ],
          heartRateZones: [
            { zone: 'Z1', minBpm: 0, maxBpm: 121, timeS: 10, percentage: 0.01 },
            { zone: 'Z2', minBpm: 122, maxBpm: 151, timeS: 140, percentage: 0.14 },
            { zone: 'Z3', minBpm: 152, maxBpm: 166, timeS: 80, percentage: 0.08 },
            { zone: 'Z4', minBpm: 167, maxBpm: 180, timeS: 760, percentage: 0.76 },
            { zone: 'Z5', minBpm: 181, maxBpm: null, timeS: 10, percentage: 0.01 },
          ],
          splits: [
            {
              splitIndex: 1,
              distanceM: 1000,
              elapsedTimeS: 360,
              elevationDifferenceM: 1,
              averageSpeedMps: 2.78,
              paceSecPerKm: 360,
              averageHeartrate: 150,
              averageCadence: 84,
              calories: 62,
            },
          ],
        });
      }

      return createResponse({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [
          {
            stravaId: 1,
            name: 'Morning Run',
            startDateLocal: '2026-01-01T08:00:00Z',
            distanceM: 10000,
            movingTimeS: 3600,
            elapsedTimeS: 3660,
            totalElevationGainM: 100,
            averageSpeedMps: 2.7,
            maxSpeedMps: 4,
            paceSecPerKm: 360,
            averageHeartrate: 150,
            maxHeartrate: 170,
            athleteMaxHeartrate: 186,
            averageCadence: 80,
            sufferScore: 50,
            mapSummaryPolyline: null,
            mapPolyline: null,
            updatedAt: '2026-01-01T09:00:00Z',
          },
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<App />);

    await screen.findByText('Morning Run');
    expect(await screen.findByText('总跑步次数')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Morning Run'));
    await screen.findByText('单次跑步详情');
    expect(await screen.findByText('心率趋势')).toBeInTheDocument();
    expect(await screen.findByText('配速趋势')).toBeInTheDocument();
    expect(await screen.findByText('心率区间')).toBeInTheDocument();
    expect(await screen.findByText('来自 Strava 活动区间统计（最大心率 170 bpm）。')).toBeInTheDocument();
    expect(await screen.findByText('数据源：Strava Streams（细粒度）')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalled();
  });

  it('refetches when date filter changes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 0,
          totalDistanceM: 0,
          totalMovingTimeS: 0,
          totalElevationGainM: 0,
          averagePaceSecPerKm: null,
          bestPaceSecPerKm: null,
          averageHeartrate: null,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [1],
          },
        });
      }

      return createResponse({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    const startInput = await screen.findByLabelText('开始日期');
    fireEvent.change(startInput, { target: { value: '2026-01-01' } });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((entry) => String(entry[0]));
      expect(calls.some((url) => url.includes('from=2026-01-01'))).toBe(true);
    });
  });

  it('applies quick year-month filters', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 0,
          totalDistanceM: 0,
          totalMovingTimeS: 0,
          totalElevationGainM: 0,
          averagePaceSecPerKm: null,
          bestPaceSecPerKm: null,
          averageHeartrate: null,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [1, 2, 3],
          },
        });
      }

      return createResponse({ page: 1, pageSize: 20, total: 0, items: [] });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    const yearSelect = await screen.findByLabelText('快速筛选');
    fireEvent.change(yearSelect, { target: { value: '2026' } });
    fireEvent.click(await screen.findByRole('button', { name: '2月' }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((entry) => String(entry[0]));
      expect(calls.some((url) => url.includes('from=2026-02-01') && url.includes('to=2026-02-28'))).toBe(true);
    });
  });

  it('loads persisted analysis when opening detail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 1,
          totalDistanceM: 10000,
          totalMovingTimeS: 3600,
          totalElevationGainM: 100,
          averagePaceSecPerKm: 360,
          bestPaceSecPerKm: 340,
          averageHeartrate: 150,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [1],
          },
        });
      }
      if (url.startsWith('/api/activities/1/analysis')) {
        return createResponse({
          activityId: 1,
          content: '## 本次总结\\n状态不错',
          generatedAt: '2026-01-01T09:00:00Z',
          cached: true,
        });
      }
      if (url.startsWith('/api/activities/1')) {
        return createResponse({
          stravaId: 1,
          name: 'Morning Run',
          startDateLocal: '2026-01-01T08:00:00Z',
          distanceM: 10000,
          movingTimeS: 3600,
          elapsedTimeS: 3660,
          totalElevationGainM: 100,
          averageSpeedMps: 2.7,
          maxSpeedMps: 4,
          paceSecPerKm: 360,
          averageHeartrate: 150,
          maxHeartrate: 170,
          athleteMaxHeartrate: 186,
          averageCadence: 80,
          sufferScore: 50,
          mapSummaryPolyline: null,
          mapPolyline: null,
          updatedAt: '2026-01-01T09:00:00Z',
          splits: [],
        });
      }

      return createResponse({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [
          {
            stravaId: 1,
            name: 'Morning Run',
            startDateLocal: '2026-01-01T08:00:00Z',
            distanceM: 10000,
            movingTimeS: 3600,
            elapsedTimeS: 3660,
            totalElevationGainM: 100,
            averageSpeedMps: 2.7,
            maxSpeedMps: 4,
            paceSecPerKm: 360,
            averageHeartrate: 150,
            maxHeartrate: 170,
            athleteMaxHeartrate: 186,
            averageCadence: 80,
            sufferScore: 50,
            mapSummaryPolyline: null,
            mapPolyline: null,
            updatedAt: '2026-01-01T09:00:00Z',
          },
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    fireEvent.click(await screen.findByText('Morning Run'));

    expect(await screen.findByText(/状态不错/)).toBeInTheDocument();
  });

  it('manually syncs latest Strava data and refreshes dashboard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/sync')) {
        return createResponse({
          totalFetchedRuns: 3,
          created: 1,
          updated: 2,
          skippedNonRun: 0,
          failed: 0,
          mode: 'incremental',
          from: '2026-01-08',
        });
      }
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 1,
          totalDistanceM: 10000,
          totalMovingTimeS: 3600,
          totalElevationGainM: 100,
          averagePaceSecPerKm: 360,
          bestPaceSecPerKm: 340,
          averageHeartrate: 150,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [1],
          },
        });
      }
      if (url.startsWith('/api/activities/1/analysis')) {
        return createErrorResponse(404, { error: 'No analysis yet for this activity.' });
      }
      if (url.startsWith('/api/activities/1')) {
        return createResponse({
          stravaId: 1,
          name: 'Morning Run',
          startDateLocal: '2026-01-01T08:00:00Z',
          distanceM: 10000,
          movingTimeS: 3600,
          elapsedTimeS: 3660,
          totalElevationGainM: 100,
          averageSpeedMps: 2.7,
          maxSpeedMps: 4,
          paceSecPerKm: 360,
          averageHeartrate: 150,
          maxHeartrate: 170,
          athleteMaxHeartrate: 186,
          averageCadence: 80,
          sufferScore: 50,
          mapSummaryPolyline: null,
          mapPolyline: null,
          updatedAt: '2026-01-01T09:00:00Z',
          splits: [],
        });
      }

      if (url.startsWith('/api/activities')) {
        return createResponse({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [
            {
              stravaId: 1,
              name: 'Morning Run',
              startDateLocal: '2026-01-01T08:00:00Z',
              distanceM: 10000,
              movingTimeS: 3600,
              elapsedTimeS: 3660,
              totalElevationGainM: 100,
              averageSpeedMps: 2.7,
              maxSpeedMps: 4,
              paceSecPerKm: 360,
              averageHeartrate: 150,
              maxHeartrate: 170,
              athleteMaxHeartrate: 186,
              averageCadence: 80,
              sufferScore: 50,
              mapSummaryPolyline: null,
              mapPolyline: null,
              updatedAt: '2026-01-01T09:00:00Z',
            },
          ],
        });
      }

      return createErrorResponse(404, { error: 'unexpected request' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '手动同步最新数据' }));

    expect(await screen.findByText(/同步完成：新增 1 条，更新 2 条，失败 0 条/)).toBeInTheDocument();

    const syncCall = fetchMock.mock.calls.find((entry) => String(entry[0]).startsWith('/api/sync'));
    expect(syncCall).toBeTruthy();
    expect((syncCall?.[1] as RequestInit | undefined)?.method).toBe('POST');

    const summaryCalls = fetchMock.mock.calls.filter((entry) => String(entry[0]).startsWith('/api/summary'));
    expect(summaryCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('generates week/month/year period analysis in realtime', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/analysis/period')) {
        return createResponse({
          period: 'week',
          from: '2026-02-09',
          to: '2026-02-11',
          generatedAt: '2026-02-11T08:00:00.000Z',
          content: '## 周期总结\\n周训练状态稳定',
        });
      }
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 1,
          totalDistanceM: 10000,
          totalMovingTimeS: 3600,
          totalElevationGainM: 100,
          averagePaceSecPerKm: 360,
          bestPaceSecPerKm: 340,
          averageHeartrate: 150,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [2],
          },
        });
      }
      if (url.startsWith('/api/activities')) {
        return createResponse({ page: 1, pageSize: 20, total: 0, items: [] });
      }

      return createErrorResponse(404, { error: 'unexpected request' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '按周分析' }));

    expect(await screen.findByText(/周训练状态稳定/)).toBeInTheDocument();
    expect(await screen.findByText(/本周/)).toBeInTheDocument();

    const periodCall = fetchMock.mock.calls.find((entry) => String(entry[0]).startsWith('/api/analysis/period'));
    expect(periodCall).toBeTruthy();
  });

  it('estimates heart rate zones with Strava-like thresholds when zone payload is missing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/summary')) {
        return createResponse({
          totalRuns: 1,
          totalDistanceM: 8000,
          totalMovingTimeS: 3000,
          totalElevationGainM: 80,
          averagePaceSecPerKm: 375,
          bestPaceSecPerKm: 350,
          averageHeartrate: 140,
        });
      }
      if (url.startsWith('/api/trends/weekly')) {
        return createResponse([]);
      }
      if (url.startsWith('/api/filters/calendar')) {
        return createResponse({
          years: [2026],
          monthsByYear: {
            '2026': [2],
          },
        });
      }
      if (url.startsWith('/api/activities/2/analysis')) {
        return createErrorResponse(404, { error: 'No analysis yet for this activity.' });
      }
      if (url.startsWith('/api/activities/2')) {
        return createResponse({
          stravaId: 2,
          name: 'Easy Run',
          startDateLocal: '2026-02-10T08:00:00Z',
          distanceM: 8000,
          movingTimeS: 3000,
          elapsedTimeS: 3050,
          totalElevationGainM: 50,
          averageSpeedMps: 2.66,
          maxSpeedMps: 4.1,
          paceSecPerKm: 375,
          averageHeartrate: 140,
          maxHeartrate: 187,
          athleteMaxHeartrate: 187,
          averageCadence: 82,
          sufferScore: 40,
          mapSummaryPolyline: null,
          mapPolyline: null,
          updatedAt: '2026-02-10T09:00:00Z',
          splits: [
            {
              splitIndex: 1,
              distanceM: 1000,
              elapsedTimeS: 360,
              elevationDifferenceM: 1,
              averageSpeedMps: 2.78,
              paceSecPerKm: 360,
              averageHeartrate: 148,
              averageCadence: 84,
              calories: 62,
            },
            {
              splitIndex: 2,
              distanceM: 1000,
              elapsedTimeS: 390,
              elevationDifferenceM: 1,
              averageSpeedMps: 2.56,
              paceSecPerKm: 390,
              averageHeartrate: 150,
              averageCadence: 82,
              calories: 64,
            },
          ],
        });
      }
      if (url.startsWith('/api/activities')) {
        return createResponse({
          page: 1,
          pageSize: 20,
          total: 1,
          items: [
            {
              stravaId: 2,
              name: 'Easy Run',
              startDateLocal: '2026-02-10T08:00:00Z',
              distanceM: 8000,
              movingTimeS: 3000,
              elapsedTimeS: 3050,
              totalElevationGainM: 50,
              averageSpeedMps: 2.66,
              maxSpeedMps: 4.1,
              paceSecPerKm: 375,
              averageHeartrate: 140,
              maxHeartrate: 187,
              athleteMaxHeartrate: 187,
              averageCadence: 82,
              sufferScore: 40,
              mapSummaryPolyline: null,
              mapPolyline: null,
              updatedAt: '2026-02-10T09:00:00Z',
            },
          ],
        });
      }

      return createErrorResponse(404, { error: 'unexpected request' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<App />);

    fireEvent.click(await screen.findByText('Easy Run'));

    expect(await screen.findByText('区间数据缺失，已按分段心率估算（最大心率 187 bpm）。')).toBeInTheDocument();
    expect(await screen.findByText('0-122 bpm')).toBeInTheDocument();
    expect(await screen.findByText('123-151 bpm')).toBeInTheDocument();
    expect(await screen.findByText('152-166 bpm')).toBeInTheDocument();
    expect(await screen.findByText('167-181 bpm')).toBeInTheDocument();
    expect(await screen.findByText('>182 bpm')).toBeInTheDocument();
  });
});
