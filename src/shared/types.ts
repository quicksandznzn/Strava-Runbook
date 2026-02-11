export type ActivitySortBy = 'start_date_local' | 'distance_m' | 'pace_sec_per_km';
export type SortDirection = 'asc' | 'desc';

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface ActivityQuery extends DateRangeQuery {
  page: number;
  pageSize: number;
  sortBy: ActivitySortBy;
  sortDir: SortDirection;
}

export interface RunSplit {
  splitIndex: number;
  distanceM: number;
  elapsedTimeS: number;
  elevationDifferenceM: number | null;
  averageSpeedMps: number | null;
  paceSecPerKm: number | null;
}

export interface RunActivity {
  stravaId: number;
  name: string;
  startDateLocal: string;
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  totalElevationGainM: number;
  averageSpeedMps: number | null;
  maxSpeedMps: number | null;
  paceSecPerKm: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  sufferScore: number | null;
  mapSummaryPolyline: string | null;
  mapPolyline: string | null;
  splits?: RunSplit[];
  updatedAt: string;
}

export interface SummaryMetrics {
  totalRuns: number;
  totalDistanceM: number;
  totalMovingTimeS: number;
  totalElevationGainM: number;
  averagePaceSecPerKm: number | null;
  bestPaceSecPerKm: number | null;
  averageHeartrate: number | null;
}

export interface WeeklyTrendPoint {
  weekStart: string;
  totalDistanceM: number;
  totalMovingTimeS: number;
  averagePaceSecPerKm: number | null;
  runs: number;
}

export interface PaginatedActivities {
  page: number;
  pageSize: number;
  total: number;
  items: RunActivity[];
}

export interface ActivityAiAnalysis {
  activityId: number;
  content: string;
  generatedAt: string;
  cached: boolean;
}

export interface CalendarFilterOptions {
  years: number[];
  monthsByYear: Record<string, number[]>;
}

export interface TrainingPlan {
  id: number;
  date: string; // YYYY-MM-DD
  planText: string;
  createdAt: string;
  updatedAt: string;
}

export type CompletionStatus = 'completed' | 'missed' | 'no_plan';

export interface DailySummary {
  date: string;
  plan: TrainingPlan | null;
  activities: RunActivity[];
  completionStatus: CompletionStatus;
}
