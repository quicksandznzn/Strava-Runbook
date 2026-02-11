import type {
  ActivityAiAnalysis,
  CalendarFilterOptions,
  PaginatedActivities,
  RunActivity,
  SummaryMetrics,
  WeeklyTrendPoint,
} from '../shared/types.js';

export interface QueryParams {
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
}

function buildQuery(query: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') {
      continue;
    }
    params.set(key, String(value));
  }
  const raw = params.toString();
  return raw ? `?${raw}` : '';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

export const api = {
  getSummary(query: QueryParams): Promise<SummaryMetrics> {
    return requestJson(`/api/summary${buildQuery(query)}`);
  },

  getWeeklyTrends(query: QueryParams): Promise<WeeklyTrendPoint[]> {
    return requestJson(`/api/trends/weekly${buildQuery(query)}`);
  },

  getCalendarFilterOptions(): Promise<CalendarFilterOptions> {
    return requestJson('/api/filters/calendar');
  },

  getActivities(query: QueryParams): Promise<PaginatedActivities> {
    return requestJson(`/api/activities${buildQuery(query)}`);
  },

  getActivity(id: number): Promise<RunActivity> {
    return requestJson(`/api/activities/${id}`);
  },

  async getActivityAnalysis(id: number): Promise<ActivityAiAnalysis | null> {
    const response = await fetch(`/api/activities/${id}/analysis`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    return (await response.json()) as ActivityAiAnalysis;
  },

  generateActivityAnalysis(id: number, force = false): Promise<ActivityAiAnalysis> {
    return requestJson(`/api/activities/${id}/analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force }),
    });
  },
};
