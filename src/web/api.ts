import type {
  ActivityAiAnalysis,
  CalendarFilterOptions,
  DailySummary,
  PaginatedActivities,
  RunActivity,
  SummaryMetrics,
  TrainingPlan,
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

  getActivityAnalysis(id: number): Promise<ActivityAiAnalysis> {
    return requestJson(`/api/activities/${id}/analysis`);
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

  getTrainingPlansByRange(from?: string, to?: string): Promise<TrainingPlan[]> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return requestJson(`/api/training-plans${query ? `?${query}` : ''}`);
  },

  getTrainingPlanByDate(date: string): Promise<TrainingPlan | null> {
    return fetch(`/api/training-plans/${date}`).then(async (response) => {
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return (await response.json()) as TrainingPlan;
    });
  },

  createTrainingPlan(date: string, planText: string): Promise<TrainingPlan> {
    return requestJson('/api/training-plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date, planText }),
    });
  },

  updateTrainingPlan(date: string, planText: string): Promise<TrainingPlan> {
    return requestJson(`/api/training-plans/${date}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ planText }),
    });
  },

  deleteTrainingPlan(date: string): Promise<{ deleted: boolean }> {
    return requestJson(`/api/training-plans/${date}`, {
      method: 'DELETE',
    });
  },

  getDailySummary(year: number, month: number): Promise<DailySummary[]> {
    return requestJson(`/api/calendar/daily-summary?year=${year}&month=${month}`);
  },
};
