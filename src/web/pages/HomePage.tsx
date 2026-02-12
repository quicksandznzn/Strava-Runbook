import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  ActivitySortBy,
  CalendarFilterOptions,
  PaginatedActivities,
  RunActivity,
  RunHeartRateZone,
  RunSplit,
  RunTrendPoint,
  SummaryMetrics,
  TrainingPlan,
  WeeklyTrendPoint,
} from '../../shared/types.js';
import { api } from '../api.js';
import { formatDateTime, formatDistance, formatDuration, formatElevation, formatHeartRate, formatPace } from '../format.js';
import { MetricCard } from '../components/shared/MetricCard.js';
import { RunMap } from '../components/shared/RunMap.js';

const PAGE_SIZE = 20;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DateFilter {
  from?: string;
  to?: string;
}

interface DetailTrendPoint {
  elapsedTimeS: number;
  distanceM: number | null;
  paceSecPerKm: number | null;
  heartrate: number | null;
}

interface HeartRateZonePoint {
  zone: string;
  minBpm: number;
  maxBpm: number | null;
  durationSec: number;
  ratio: number;
  color: string;
}

interface HeartRateZoneSummary {
  source: 'strava' | 'estimated';
  maxHeartRate: number | null;
  totalDurationSec: number;
  zones: HeartRateZonePoint[];
}

interface SplitPerformancePoint {
  splitIndex: number;
  distanceM: number;
  elapsedTimeS: number;
  paceSecPerKm: number | null;
  averageHeartrate: number | null;
  averageCadence: number | null;
  elevationDifferenceM: number | null;
  barWidthPercent: number;
}

const HEART_RATE_ZONE_EDGES = [0.65, 0.81, 0.89, 0.97] as const;
const HEART_RATE_ZONE_COLORS = ['#ef8080', '#f06b6b', '#f14f4f', '#d93a3a', '#a82424'] as const;

function resolveMaxHeartRate(splits: RunSplit[] | undefined, maxHeartRate: number | null): number {
  const maxFromDetail = typeof maxHeartRate === 'number' && Number.isFinite(maxHeartRate) ? maxHeartRate : 0;
  const maxFromSplits = (splits ?? []).reduce((currentMax, split) => {
    if (typeof split.averageHeartrate !== 'number' || !Number.isFinite(split.averageHeartrate)) {
      return currentMax;
    }
    return Math.max(currentMax, split.averageHeartrate);
  }, 0);
  const resolved = Math.max(maxFromDetail, maxFromSplits, 160);
  return Math.round(resolved);
}

function resolveStravaMaxHeartRate(zones: RunHeartRateZone[], maxHeartRate: number | null): number | null {
  if (typeof maxHeartRate === 'number' && Number.isFinite(maxHeartRate) && maxHeartRate > 0) {
    return Math.round(maxHeartRate);
  }

  const maxFromZones = zones.reduce((currentMax, zone) => {
    const candidate = zone.maxBpm ?? zone.minBpm;
    if (!Number.isFinite(candidate)) {
      return currentMax;
    }
    return Math.max(currentMax, candidate);
  }, 0);

  return maxFromZones > 0 ? Math.round(maxFromZones) : null;
}

function buildStravaHeartRateZoneSummary(
  zones: RunHeartRateZone[] | undefined,
  maxHeartRate: number | null,
): HeartRateZoneSummary | null {
  if (!zones || zones.length === 0) {
    return null;
  }

  const normalized = [...zones]
    .map((zone) => ({
      zone: zone.zone,
      minBpm: Math.max(0, Number(zone.minBpm)),
      maxBpm: zone.maxBpm == null || !Number.isFinite(Number(zone.maxBpm)) ? null : Number(zone.maxBpm),
      durationSec: Math.max(0, Number(zone.timeS)),
      ratio: zone.percentage == null ? NaN : Number(zone.percentage),
      color: HEART_RATE_ZONE_COLORS[Number(zone.zone.replace(/\D/g, '')) - 1] ?? HEART_RATE_ZONE_COLORS[0],
    }))
    .filter((zone) => Number.isFinite(zone.minBpm) && Number.isFinite(zone.durationSec))
    .sort((a, b) => a.minBpm - b.minBpm);

  if (normalized.length === 0) {
    return null;
  }

  const totalDurationSec = normalized.reduce((sum, zone) => sum + zone.durationSec, 0);
  const normalizedZones = normalized.map((zone) => {
    const ratioFromPayloadRaw = Number.isFinite(zone.ratio) ? Math.max(0, zone.ratio) : NaN;
    const ratioFromPayload =
      Number.isFinite(ratioFromPayloadRaw) && ratioFromPayloadRaw > 1 && ratioFromPayloadRaw <= 100
        ? ratioFromPayloadRaw / 100
        : ratioFromPayloadRaw;
    const ratio = Number.isFinite(ratioFromPayload) ? ratioFromPayload : totalDurationSec > 0 ? zone.durationSec / totalDurationSec : 0;
    return {
      ...zone,
      ratio,
    };
  });

  return {
    source: 'strava',
    maxHeartRate: resolveStravaMaxHeartRate(zones, maxHeartRate),
    totalDurationSec,
    zones: normalizedZones,
  };
}

function buildEstimatedHeartRateZoneSummary(splits: RunSplit[] | undefined, maxHeartRate: number | null): HeartRateZoneSummary | null {
  const validSplits = (splits ?? []).filter(
    (split) =>
      typeof split.averageHeartrate === 'number' &&
      Number.isFinite(split.averageHeartrate) &&
      typeof split.elapsedTimeS === 'number' &&
      split.elapsedTimeS > 0,
  );

  if (validSplits.length === 0) {
    return null;
  }

  const resolvedMaxHeartRate = resolveMaxHeartRate(validSplits, maxHeartRate);
  const boundaries = HEART_RATE_ZONE_EDGES.map((edge) => Math.round(resolvedMaxHeartRate * edge));
  const zones: HeartRateZonePoint[] = [
    { zone: 'Z1', minBpm: 0, maxBpm: boundaries[0], durationSec: 0, ratio: 0, color: HEART_RATE_ZONE_COLORS[0] },
    { zone: 'Z2', minBpm: boundaries[0] + 1, maxBpm: boundaries[1], durationSec: 0, ratio: 0, color: HEART_RATE_ZONE_COLORS[1] },
    { zone: 'Z3', minBpm: boundaries[1] + 1, maxBpm: boundaries[2], durationSec: 0, ratio: 0, color: HEART_RATE_ZONE_COLORS[2] },
    { zone: 'Z4', minBpm: boundaries[2] + 1, maxBpm: boundaries[3], durationSec: 0, ratio: 0, color: HEART_RATE_ZONE_COLORS[3] },
    { zone: 'Z5', minBpm: boundaries[3] + 1, maxBpm: null, durationSec: 0, ratio: 0, color: HEART_RATE_ZONE_COLORS[4] },
  ];

  for (const split of validSplits) {
    const heartrate = split.averageHeartrate ?? 0;
    const duration = split.elapsedTimeS;
    const zoneIndex = zones.findIndex((zone) => {
      if (zone.maxBpm == null) {
        return heartrate >= zone.minBpm;
      }
      return heartrate >= zone.minBpm && heartrate <= zone.maxBpm;
    });
    const resolvedIndex = zoneIndex === -1 ? zones.length - 1 : zoneIndex;
    zones[resolvedIndex].durationSec += duration;
  }

  const totalDurationSec = zones.reduce((sum, zone) => sum + zone.durationSec, 0);
  if (totalDurationSec <= 0) {
    return null;
  }

  return {
    source: 'estimated',
    maxHeartRate: resolvedMaxHeartRate,
    totalDurationSec,
    zones: zones.map((zone) => ({
      ...zone,
      ratio: zone.durationSec / totalDurationSec,
    })),
  };
}

function formatPaceCompact(paceSecPerKm: number | null): string {
  const raw = formatPace(paceSecPerKm);
  if (raw === '--') {
    return raw;
  }
  return raw.replace(' /km', '');
}

function formatDistanceAxisTick(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    return '0 km';
  }
  const km = distanceM / 1000;
  const rounded = Math.round(km);
  if (Math.abs(km - rounded) < 0.05) {
    return `${rounded} km`;
  }
  return `${km.toFixed(1)} km`;
}

function formatElapsedAxisLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return '--';
  }
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function mapSplitTrendPoints(splits: RunSplit[] | undefined): DetailTrendPoint[] {
  if (!splits || splits.length === 0) {
    return [];
  }

  const points: DetailTrendPoint[] = [];
  let cumulativeSeconds = 0;
  let cumulativeDistance = 0;
  for (const split of splits) {
    cumulativeSeconds += split.elapsedTimeS;
    cumulativeDistance += split.distanceM;
    points.push({
      elapsedTimeS: cumulativeSeconds,
      distanceM: cumulativeDistance,
      paceSecPerKm: split.paceSecPerKm,
      heartrate: split.averageHeartrate,
    });
  }
  return points;
}

function buildSplitPerformancePoints(splits: RunSplit[] | undefined): SplitPerformancePoint[] {
  if (!splits || splits.length === 0) {
    return [];
  }

  const paceValues = splits
    .map((split) => split.paceSecPerKm)
    .filter((pace): pace is number => typeof pace === 'number' && Number.isFinite(pace) && pace > 0);
  const fastestPace = paceValues.length > 0 ? Math.min(...paceValues) : null;

  return splits.map((split) => {
    const pace = split.paceSecPerKm;
    const validPace = typeof pace === 'number' && Number.isFinite(pace) && pace > 0 ? pace : null;
    const rawScore = validPace != null && fastestPace != null ? (fastestPace / validPace) * 100 : null;
    const barWidthPercent = rawScore == null ? 0 : Math.min(100, Math.max(8, Math.round(rawScore)));

    return {
      splitIndex: split.splitIndex,
      distanceM: split.distanceM,
      elapsedTimeS: split.elapsedTimeS,
      paceSecPerKm: split.paceSecPerKm,
      averageHeartrate: split.averageHeartrate,
      averageCadence: split.averageCadence,
      elevationDifferenceM: split.elevationDifferenceM,
      barWidthPercent,
    };
  });
}

function normalizeTrendPoints(trendPoints: RunTrendPoint[] | undefined): DetailTrendPoint[] {
  if (!trendPoints || trendPoints.length === 0) {
    return [];
  }

  return trendPoints
    .filter((point) => Number.isFinite(point.elapsedTimeS) && point.elapsedTimeS >= 0)
    .map((point) => ({
      elapsedTimeS: point.elapsedTimeS,
      distanceM: point.distanceM,
      paceSecPerKm: point.paceSecPerKm,
      heartrate: point.heartrate,
    }))
    .sort((a, b) => a.elapsedTimeS - b.elapsedTimeS);
}

function formatHeartRateZoneRange(minBpm: number, maxBpm: number | null): string {
  if (maxBpm == null) {
    return `>${minBpm} bpm`;
  }
  return `${minBpm}-${maxBpm} bpm`;
}

function formatSplitElevationValue(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)}`;
}

function formatSplitHeartRateValue(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)}`;
}

function formatSplitCadenceValue(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)}`;
}

function buildMonthDateRange(year: number, month: number): DateFilter {
  const paddedMonth = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${paddedMonth}-01`,
    to: `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

function formatDistanceTooltipValue(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return formatDistance(numeric);
}

function formatPaceTooltipValue(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value ?? NaN);
  return Number.isFinite(numeric) ? formatPace(numeric) : '--';
}

function useQueryData(filters: DateFilter, page: number, sortBy: ActivitySortBy, sortDir: 'asc' | 'desc') {
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [trends, setTrends] = useState<WeeklyTrendPoint[]>([]);
  const [activities, setActivities] = useState<PaginatedActivities>({ page: 1, pageSize: PAGE_SIZE, total: 0, items: [] });
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setState('loading');
      setError(null);

      try {
        const [summaryResult, trendsResult, activitiesResult] = await Promise.all([
          api.getSummary(filters),
          api.getWeeklyTrends(filters),
          api.getActivities({ ...filters, page, pageSize: PAGE_SIZE, sortBy, sortDir }),
        ]);

        if (cancelled) {
          return;
        }

        setSummary(summaryResult);
        setTrends(trendsResult);
        setActivities(activitiesResult);
        setState('ready');
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setState('error');
        setError(loadError instanceof Error ? loadError.message : '加载失败');
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [filters.from, filters.to, page, sortBy, sortDir]);

  return { summary, trends, activities, state, error };
}

function DetailTrendTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DetailTrendPoint }>;
  metric: 'pace' | 'heartrate';
}) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) {
    return null;
  }

  const point = payload[0].payload;
  const primary = metric === 'pace' ? formatPace(point.paceSecPerKm) : formatHeartRate(point.heartrate);
  const secondary = point.distanceM != null ? `${(point.distanceM / 1000).toFixed(2)} km` : `用时 ${formatElapsedAxisLabel(point.elapsedTimeS)}`;
  return (
    <div className={`trend-tooltip ${metric === 'pace' ? 'pace' : 'heart'}`}>
      <div className="trend-tooltip-primary">{primary}</div>
      <div className="trend-tooltip-secondary">{secondary}</div>
    </div>
  );
}

export function HomePage() {
  const [filters, setFilters] = useState<DateFilter>({});
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ActivitySortBy>('start_date_local');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedActivity, setSelectedActivity] = useState<RunActivity | null>(null);
  const [selectedActivityPlan, setSelectedActivityPlan] = useState<TrainingPlan | null>(null);
  const [selectedActivityPlanState, setSelectedActivityPlanState] = useState<LoadState>('idle');
  const [selectedActivityPlanError, setSelectedActivityPlanError] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<LoadState>('idle');
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [analysisById, setAnalysisById] = useState<Record<number, string>>({});
  const [analysisStateById, setAnalysisStateById] = useState<Record<number, LoadState>>({});
  const [analysisErrorById, setAnalysisErrorById] = useState<Record<number, string | null>>({});
  const [calendarOptions, setCalendarOptions] = useState<CalendarFilterOptions>({ years: [], monthsByYear: {} });
  const [quickYear, setQuickYear] = useState<number | ''>('');
  const [quickMonth, setQuickMonth] = useState<number | ''>('');

  const { summary, trends, activities, state, error } = useQueryData(filters, page, sortBy, sortDir);

  const totalPages = Math.max(1, Math.ceil(activities.total / activities.pageSize));
  const availableMonths = quickYear ? calendarOptions.monthsByYear[String(quickYear)] ?? [] : [];
  const detailTrendData = useMemo<DetailTrendPoint[]>(() => {
    const streamPoints = normalizeTrendPoints(selectedActivity?.trendPoints);
    if (streamPoints.length > 0) {
      return streamPoints;
    }
    return mapSplitTrendPoints(selectedActivity?.splits);
  }, [selectedActivity?.trendPoints, selectedActivity?.splits]);
  const hasDistanceAxis = useMemo(
    () => detailTrendData.some((point) => typeof point.distanceM === 'number' && Number.isFinite(point.distanceM) && point.distanceM > 0),
    [detailTrendData],
  );
  const heartrateValueRange = useMemo(() => {
    const values = detailTrendData
      .map((point) => point.heartrate)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (values.length === 0) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(4, (max - min) * 0.2);
    return [Math.max(0, min - padding), max + padding] as [number, number];
  }, [detailTrendData]);
  const paceValueRange = useMemo(() => {
    const paceValues = detailTrendData
      .map((point) => point.paceSecPerKm)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (paceValues.length === 0) {
      return null;
    }
    const min = Math.min(...paceValues);
    const max = Math.max(...paceValues);
    const padding = Math.max(8, (max - min) * 0.12);
    return [Math.max(0, min - padding), max + padding] as [number, number];
  }, [detailTrendData]);
  const heartRateZoneSummary = useMemo(() => {
    const stravaSummary = buildStravaHeartRateZoneSummary(selectedActivity?.heartRateZones, selectedActivity?.maxHeartrate ?? null);
    if (stravaSummary) {
      return stravaSummary;
    }
    return buildEstimatedHeartRateZoneSummary(selectedActivity?.splits, selectedActivity?.athleteMaxHeartrate ?? null);
  }, [selectedActivity?.heartRateZones, selectedActivity?.maxHeartrate, selectedActivity?.splits, selectedActivity?.athleteMaxHeartrate]);
  const splitPerformanceData = useMemo(() => buildSplitPerformancePoints(selectedActivity?.splits), [selectedActivity?.splits]);

  useEffect(() => {
    let cancelled = false;
    async function loadCalendarOptions(): Promise<void> {
      try {
        const options = await api.getCalendarFilterOptions();
        if (!cancelled) {
          setCalendarOptions(options);
        }
      } catch {
        if (!cancelled) {
          setCalendarOptions({ years: [], monthsByYear: {} });
        }
      }
    }
    void loadCalendarOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openActivity(id: number): Promise<RunActivity | null> {
    setDrawerState('loading');
    setDrawerError(null);
    setSelectedActivityPlan(null);
    setSelectedActivityPlanState('idle');
    setSelectedActivityPlanError(null);

    try {
      const detail = await api.getActivity(id);
      setSelectedActivity(detail);
      setSelectedActivityPlanState('loading');

      try {
        const date = detail.startDateLocal.split('T')[0];
        const plan = await api.getTrainingPlanByDate(date);
        setSelectedActivityPlan(plan);
        setSelectedActivityPlanState('ready');
      } catch (planError) {
        setSelectedActivityPlanState('error');
        setSelectedActivityPlanError(planError instanceof Error ? planError.message : '加载训练计划失败');
      }

      setDrawerState('ready');
      return detail;
    } catch (detailError) {
      setDrawerState('error');
      setDrawerError(detailError instanceof Error ? detailError.message : '加载详情失败');
      return null;
    }
  }

  function closeActivityDrawer(): void {
    setSelectedActivity(null);
    setSelectedActivityPlan(null);
    setSelectedActivityPlanState('idle');
    setSelectedActivityPlanError(null);
  }

  async function generateAnalysis(activityId: number, force = false): Promise<void> {
    setAnalysisStateById((current) => ({ ...current, [activityId]: 'loading' }));
    setAnalysisErrorById((current) => ({ ...current, [activityId]: null }));

    try {
      const response = await api.generateActivityAnalysis(activityId, force);
      setAnalysisById((current) => ({ ...current, [activityId]: response.content }));
      setAnalysisStateById((current) => ({ ...current, [activityId]: 'ready' }));
    } catch (analysisError) {
      setAnalysisStateById((current) => ({ ...current, [activityId]: 'error' }));
      setAnalysisErrorById((current) => ({
        ...current,
        [activityId]: analysisError instanceof Error ? analysisError.message : 'AI 分析生成失败',
      }));
    }
  }

  async function openAndGenerateAnalysis(activityId: number): Promise<void> {
    const detail = await openActivity(activityId);
    if (!detail) {
      return;
    }
    await generateAnalysis(activityId);
  }

  function toggleSort(nextSortBy: ActivitySortBy): void {
    if (nextSortBy === sortBy) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(nextSortBy);
      setSortDir(nextSortBy === 'start_date_local' ? 'desc' : 'asc');
    }
    setPage(1);
  }

  function onDateChange(name: 'from' | 'to', value: string): void {
    setFilters((current) => ({ ...current, [name]: value || undefined }));
    setQuickYear('');
    setQuickMonth('');
    setPage(1);
  }

  function applyYearQuickFilter(nextYear: number | ''): void {
    setQuickYear(nextYear);
    setQuickMonth('');
    if (nextYear === '') {
      setFilters({});
    } else {
      setFilters({
        from: `${nextYear}-01-01`,
        to: `${nextYear}-12-31`,
      });
    }
    setPage(1);
  }

  function applyMonthQuickFilter(month: number): void {
    if (quickYear === '') {
      return;
    }
    setQuickMonth(month);
    setFilters(buildMonthDateRange(quickYear, month));
    setPage(1);
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="hero-kicker">RUN STRAVA</p>
          <h1>个人跑步数据仪表盘</h1>
          <p className="hero-subtitle">手动同步 Strava 数据，按周趋势分析训练状态（时间口径：上海 UTC+8）。</p>
        </div>
        <div className="hero-controls">
          <label>
            开始日期
            <input type="date" value={filters.from ?? ''} onChange={(event) => onDateChange('from', event.target.value)} />
          </label>
          <label>
            结束日期
            <input type="date" value={filters.to ?? ''} onChange={(event) => onDateChange('to', event.target.value)} />
          </label>
          <button
            className="ghost-btn"
            onClick={() => {
              setFilters({});
              setQuickYear('');
              setQuickMonth('');
              setPage(1);
            }}
          >
            清空筛选
          </button>
        </div>
      </header>

      <section className="quick-filter card">
        <div className="quick-filter-row">
          <label htmlFor="quick-year-select">快速筛选</label>
          <select
            id="quick-year-select"
            value={quickYear === '' ? '' : String(quickYear)}
            onChange={(event) => {
              const raw = event.target.value;
              applyYearQuickFilter(raw ? Number(raw) : '');
            }}
          >
            <option value="">全部年份</option>
            {calendarOptions.years.map((year) => (
              <option key={year} value={year}>
                {year}年
              </option>
            ))}
          </select>
          {quickYear !== '' ? (
            <button className="ghost-btn" onClick={() => applyYearQuickFilter(quickYear)}>
              全年
            </button>
          ) : null}
        </div>
        <div className="month-chip-wrap">
          {quickYear === '' ? (
            <span className="month-tip">先选择年份，再点击月份。</span>
          ) : (
            Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
              const available = availableMonths.includes(month);
              return (
                <button
                  key={month}
                  className={`month-chip ${quickMonth === month ? 'active' : ''}`}
                  disabled={!available}
                  onClick={() => applyMonthQuickFilter(month)}
                >
                  {month}月
                </button>
              );
            })
          )}
        </div>
      </section>

      {state === 'error' ? <div className="error-banner">{error}</div> : null}

      <section className="metrics-grid" aria-live="polite">
        <MetricCard title="总跑步次数" value={summary ? `${summary.totalRuns}` : '--'} />
        <MetricCard title="总里程" value={summary ? formatDistance(summary.totalDistanceM) : '--'} />
        <MetricCard title="平均配速" value={summary ? formatPace(summary.averagePaceSecPerKm) : '--'} />
        <MetricCard title="总爬升" value={summary ? formatElevation(summary.totalElevationGainM) : '--'} />
      </section>

      <section className="charts-grid">
        <article className="card">
          <h2>周里程趋势</h2>
          {trends.length === 0 ? (
            <div className="empty-box">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="weekStart" />
                <YAxis />
                <Tooltip formatter={formatDistanceTooltipValue} />
                <Legend />
                <Bar dataKey="totalDistanceM" fill="#ff6d3f" name="里程" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </article>

        <article className="card">
          <h2>周均配速</h2>
          {trends.length === 0 ? (
            <div className="empty-box">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="weekStart" />
                <YAxis />
                <Tooltip formatter={formatPaceTooltipValue} />
                <Legend />
                <Line type="monotone" dataKey="averagePaceSecPerKm" stroke="#0e8892" name="配速" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>
      </section>

      <section className="card">
        <div className="table-header">
          <h2>跑步记录</h2>
          <p>
            第 {activities.page} / {totalPages} 页 · 共 {activities.total} 条
          </p>
        </div>

        {state === 'loading' ? <div className="empty-box">正在加载...</div> : null}

        {state !== 'loading' && activities.items.length === 0 ? <div className="empty-box">暂无跑步记录</div> : null}

        {activities.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <button className="sort-btn" onClick={() => toggleSort('start_date_local')}>
                      日期 {sortBy === 'start_date_local' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </button>
                  </th>
                  <th>名称</th>
                  <th>
                    <button className="sort-btn" onClick={() => toggleSort('distance_m')}>
                      距离 {sortBy === 'distance_m' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </button>
                  </th>
                  <th>时长</th>
                  <th>
                    <button className="sort-btn" onClick={() => toggleSort('pace_sec_per_km')}>
                      配速 {sortBy === 'pace_sec_per_km' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </button>
                  </th>
                  <th>爬升</th>
                  <th>心率</th>
                  <th>AI分析</th>
                </tr>
              </thead>
              <tbody>
                {activities.items.map((item) => (
                  <tr key={item.stravaId} onClick={() => void openActivity(item.stravaId)} className="click-row">
                    <td>{formatDateTime(item.startDateLocal)}</td>
                    <td>{item.name}</td>
                    <td>{formatDistance(item.distanceM)}</td>
                    <td>{formatDuration(item.movingTimeS)}</td>
                    <td>{formatPace(item.paceSecPerKm)}</td>
                    <td>{formatElevation(item.totalElevationGainM)}</td>
                    <td>{formatHeartRate(item.averageHeartrate)}</td>
                    <td>
                      <button
                        className="analysis-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openAndGenerateAnalysis(item.stravaId);
                        }}
                        disabled={analysisStateById[item.stravaId] === 'loading'}
                      >
                        {analysisStateById[item.stravaId] === 'loading' ? '生成中...' : 'AI分析'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="pager">
          <button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            上一页
          </button>
          <button
            className="ghost-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
      </section>

      <aside className={`drawer ${selectedActivity || drawerState === 'loading' || drawerState === 'error' ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3>单次跑步详情</h3>
          <button className="ghost-btn" onClick={closeActivityDrawer}>
            关闭
          </button>
        </div>

        {drawerState === 'loading' ? <div className="empty-box">详情加载中...</div> : null}
        {drawerState === 'error' ? <div className="error-banner">{drawerError}</div> : null}

        {selectedActivity ? (
          <div className="drawer-content">
            <h4>{selectedActivity.name}</h4>
            <p>{formatDateTime(selectedActivity.startDateLocal)}</p>
            <div className="detail-grid">
              <MetricCard title="距离" value={formatDistance(selectedActivity.distanceM)} />
              <MetricCard title="时长" value={formatDuration(selectedActivity.movingTimeS)} />
              <MetricCard title="配速" value={formatPace(selectedActivity.paceSecPerKm)} />
              <MetricCard title="心率" value={formatHeartRate(selectedActivity.averageHeartrate)} />
            </div>

            {selectedActivity.mapPolyline ? <RunMap encodedPolyline={selectedActivity.mapPolyline} /> : <div className="empty-box">暂无地图路线</div>}

            <h4>趋势图</h4>
            <p className="trend-source-note">{selectedActivity.trendPoints?.length ? '数据源：Strava Streams（细粒度）' : '数据源：分公里 splits（降级）'}</p>
            {detailTrendData.length > 0 ? (
              <div className="detail-trends-grid">
                <section className="trend-chart-card">
                  <h5>心率趋势</h5>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={detailTrendData}>
                      <defs>
                        <linearGradient id="heartTrendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f05252" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#f05252" stopOpacity={0.08} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey={hasDistanceAxis ? 'distanceM' : 'elapsedTimeS'}
                        tickFormatter={(value) =>
                          hasDistanceAxis ? formatDistanceAxisTick(typeof value === 'number' ? value : Number(value ?? 0)) : formatElapsedAxisLabel(Number(value ?? 0))
                        }
                        minTickGap={24}
                      />
                      <YAxis domain={heartrateValueRange ?? ['auto', 'auto']} tickFormatter={(value) => `${Math.round(Number(value ?? 0))}`} />
                      <Tooltip content={<DetailTrendTooltip metric="heartrate" />} cursor={{ stroke: '#101826', strokeWidth: 1.4 }} />
                      <Area
                        type="monotone"
                        dataKey="heartrate"
                        stroke="#d33838"
                        fill="url(#heartTrendGradient)"
                        strokeWidth={2.2}
                        connectNulls
                        dot={false}
                        activeDot={{ r: 4.5, fill: '#101826', stroke: '#fff', strokeWidth: 1.2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </section>
                <section className="trend-chart-card">
                  <h5>配速趋势</h5>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={detailTrendData}>
                      <defs>
                        <linearGradient id="paceTrendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2d7fe2" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#2d7fe2" stopOpacity={0.12} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey={hasDistanceAxis ? 'distanceM' : 'elapsedTimeS'}
                        tickFormatter={(value) =>
                          hasDistanceAxis ? formatDistanceAxisTick(typeof value === 'number' ? value : Number(value ?? 0)) : formatElapsedAxisLabel(Number(value ?? 0))
                        }
                        minTickGap={24}
                      />
                      <YAxis
                        domain={paceValueRange ?? ['auto', 'auto']}
                        tickFormatter={(value) => formatPaceCompact(Number(value ?? NaN))}
                        reversed
                        width={44}
                      />
                      <Tooltip content={<DetailTrendTooltip metric="pace" />} cursor={{ stroke: '#101826', strokeWidth: 1.4 }} />
                      <Area
                        type="monotone"
                        dataKey="paceSecPerKm"
                        stroke="#2a75d2"
                        fill="url(#paceTrendGradient)"
                        strokeWidth={2.2}
                        connectNulls
                        dot={false}
                        activeDot={{ r: 4.5, fill: '#101826', stroke: '#fff', strokeWidth: 1.2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </section>
              </div>
            ) : (
              <div className="empty-box">暂无趋势图数据</div>
            )}

            <section className="heart-rate-zones-card">
              <h4>心率区间</h4>
              {heartRateZoneSummary ? (
                <>
                  <p className="heart-rate-zones-subtitle">
                    {heartRateZoneSummary.source === 'strava'
                      ? `来自 Strava 活动区间统计${
                          heartRateZoneSummary.maxHeartRate ? `（最大心率 ${heartRateZoneSummary.maxHeartRate} bpm）` : ''
                        }。`
                      : `区间数据缺失，已按分段心率估算（最大心率 ${heartRateZoneSummary.maxHeartRate ?? '--'} bpm）。`}
                  </p>
                  <div className="heart-rate-zones-list">
                    {[...heartRateZoneSummary.zones].reverse().map((zone) => {
                      const percent = Math.round(zone.ratio * 100);
                      const widthPercent = zone.ratio <= 0 ? 0 : Math.max(6, zone.ratio * 100);
                      return (
                        <div className="heart-rate-zone-row" key={zone.zone}>
                          <div className="heart-rate-zone-label">{zone.zone}</div>
                          <div className="heart-rate-zone-bar-wrap">
                            <div className="heart-rate-zone-track">
                              <div
                                className="heart-rate-zone-fill"
                                style={{ width: `${widthPercent}%`, backgroundColor: zone.color }}
                                title={`${zone.zone} ${percent}%`}
                              />
                            </div>
                            <div className="heart-rate-zone-percent">{percent}%</div>
                          </div>
                          <div className="heart-rate-zone-range">{formatHeartRateZoneRange(zone.minBpm, zone.maxBpm)}</div>
                          <div className="heart-rate-zone-duration">{formatDuration(zone.durationSec)}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-box">暂无心率区间数据</div>
              )}
            </section>

            <section className="split-performance-card">
              <h4>分段成绩</h4>
              {splitPerformanceData.length > 0 ? (
                <>
                  <div className="split-performance-header">
                    <div>Km</div>
                    <div>配速</div>
                    <div />
                    <div>海拔</div>
                    <div>心率</div>
                    <div>步频</div>
                  </div>
                  <div className="split-performance-list">
                    {splitPerformanceData.map((split) => (
                      <div className="split-performance-row" key={split.splitIndex}>
                        <div className="split-performance-km">{split.splitIndex}</div>
                        <div className="split-performance-pace">{formatPaceCompact(split.paceSecPerKm)}</div>
                        <div className="split-performance-bar-cell">
                          <div className="split-performance-track">
                            <div className="split-performance-fill" style={{ width: `${split.barWidthPercent}%` }} />
                          </div>
                        </div>
                        <div className="split-performance-elevation">{formatSplitElevationValue(split.elevationDifferenceM)}</div>
                        <div className="split-performance-heartrate">{formatSplitHeartRateValue(split.averageHeartrate)}</div>
                        <div className="split-performance-cadence">{formatSplitCadenceValue(split.averageCadence)}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-box">暂无分段数据</div>
              )}
            </section>

            <section className="analysis-panel">
              <div className="analysis-panel-header">
                <h4>关联训练计划</h4>
              </div>
              {selectedActivityPlanState === 'loading' ? <div className="empty-box">训练计划加载中...</div> : null}
              {selectedActivityPlanState === 'error' ? (
                <div className="error-banner">{selectedActivityPlanError ?? '加载训练计划失败'}</div>
              ) : null}
              {selectedActivityPlanState === 'ready' && selectedActivityPlan ? (
                <div className="training-plan-linked">
                  <div className="training-plan-linked-date">计划日期：{selectedActivityPlan.date}</div>
                  <pre className="analysis-content">{selectedActivityPlan.planText}</pre>
                </div>
              ) : null}
              {selectedActivityPlanState === 'ready' && !selectedActivityPlan ? <div className="empty-box">当日暂无训练计划</div> : null}
            </section>

            <section className="analysis-panel">
              <div className="analysis-panel-header">
                <h4>AI训练分析</h4>
                <button className="analysis-btn secondary" onClick={() => void generateAnalysis(selectedActivity.stravaId, true)}>
                  重新生成
                </button>
              </div>
              {analysisStateById[selectedActivity.stravaId] === 'loading' ? <div className="empty-box">AI 正在分析本次训练...</div> : null}
              {analysisStateById[selectedActivity.stravaId] === 'error' ? (
                <div className="error-banner">{analysisErrorById[selectedActivity.stravaId] ?? 'AI 分析生成失败'}</div>
              ) : null}
              {analysisById[selectedActivity.stravaId] ? <pre className="analysis-content">{analysisById[selectedActivity.stravaId]}</pre> : null}
              {!analysisById[selectedActivity.stravaId] && analysisStateById[selectedActivity.stravaId] !== 'loading' ? (
                <div className="empty-box">点击列表中的"AI分析"按钮来生成分析。</div>
              ) : null}
            </section>

          </div>
        ) : null}
      </aside>
    </div>
  );
}
