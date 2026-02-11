import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MapContainer, Polyline, TileLayer } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import type {
  ActivitySortBy,
  CalendarFilterOptions,
  PaginatedActivities,
  PeriodAnalysisPeriod,
  RunActivity,
  RunHeartRateZone,
  RunTrendPoint,
  RunSplit,
  SummaryMetrics,
  WeeklyTrendPoint,
} from '../shared/types.js';
import { api } from './api.js';
import { formatCadence, formatCalories, formatDateTime, formatDistance, formatDuration, formatElevation, formatHeartRate, formatPace } from './format.js';

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

function formatHeartRateZoneRange(minBpm: number, maxBpm: number | null): string {
  if (maxBpm == null) {
    return `>${minBpm} bpm`;
  }
  return `${minBpm}-${maxBpm} bpm`;
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

function useQueryData(filters: DateFilter, page: number, sortBy: ActivitySortBy, sortDir: 'asc' | 'desc', refreshKey: number) {
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
  }, [filters.from, filters.to, page, sortBy, sortDir, refreshKey]);

  return { summary, trends, activities, state, error };
}

function MetricCard(props: { title: string; value: string; note?: string }) {
  return (
    <article className="metric-card">
      <div className="metric-title">{props.title}</div>
      <div className="metric-value">{props.value}</div>
      {props.note ? <div className="metric-note">{props.note}</div> : null}
    </article>
  );
}

function RunMap({ encodedPolyline }: { encodedPolyline: string }) {
  const points = useMemo(() => {
    try {
      return polyline.decode(encodedPolyline) as [number, number][];
    } catch {
      return [];
    }
  }, [encodedPolyline]);

  if (points.length === 0) {
    return <div className="empty-box">暂无路线数据</div>;
  }

  const center = points[Math.floor(points.length / 2)];

  return (
    <div className="map-wrap">
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="run-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={points} pathOptions={{ color: '#ff6d3f', weight: 4 }} />
      </MapContainer>
    </div>
  );
}

function DetailTrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DetailTrendPoint }>;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0].payload) {
    return null;
  }

  const point = payload[0].payload;
  return (
    <div className="trend-tooltip">
      <div className="trend-tooltip-title">
        用时 {formatElapsedAxisLabel(point.elapsedTimeS)}
        {point.distanceM != null ? ` · ${formatDistance(point.distanceM)}` : ''}
      </div>
      <div>配速：{formatPace(point.paceSecPerKm)}</div>
      <div>心率：{formatHeartRate(point.heartrate)}</div>
    </div>
  );
}

export function App() {
  const [filters, setFilters] = useState<DateFilter>({});
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ActivitySortBy>('start_date_local');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedActivity, setSelectedActivity] = useState<RunActivity | null>(null);
  const [drawerState, setDrawerState] = useState<LoadState>('idle');
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [analysisById, setAnalysisById] = useState<Record<number, string>>({});
  const [analysisStateById, setAnalysisStateById] = useState<Record<number, LoadState>>({});
  const [analysisErrorById, setAnalysisErrorById] = useState<Record<number, string | null>>({});
  const [calendarOptions, setCalendarOptions] = useState<CalendarFilterOptions>({ years: [], monthsByYear: {} });
  const [quickYear, setQuickYear] = useState<number | ''>('');
  const [quickMonth, setQuickMonth] = useState<number | ''>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<LoadState>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [periodAnalysisPeriod, setPeriodAnalysisPeriod] = useState<PeriodAnalysisPeriod>('week');
  const [periodAnalysisState, setPeriodAnalysisState] = useState<LoadState>('idle');
  const [periodAnalysisContent, setPeriodAnalysisContent] = useState<string | null>(null);
  const [periodAnalysisRange, setPeriodAnalysisRange] = useState<{ from: string; to: string } | null>(null);
  const [periodAnalysisError, setPeriodAnalysisError] = useState<string | null>(null);

  const { summary, trends, activities, state, error } = useQueryData(filters, page, sortBy, sortDir, refreshKey);

  const totalPages = Math.max(1, Math.ceil(activities.total / activities.pageSize));
  const availableMonths = quickYear ? calendarOptions.monthsByYear[String(quickYear)] ?? [] : [];
  const detailTrendData = useMemo<DetailTrendPoint[]>(() => {
    const streamPoints = normalizeTrendPoints(selectedActivity?.trendPoints);
    if (streamPoints.length > 0) {
      return streamPoints;
    }
    return mapSplitTrendPoints(selectedActivity?.splits);
  }, [selectedActivity?.trendPoints, selectedActivity?.splits]);
  const heartRateZoneSummary = useMemo(() => {
    const stravaSummary = buildStravaHeartRateZoneSummary(selectedActivity?.heartRateZones, selectedActivity?.maxHeartrate ?? null);
    if (stravaSummary) {
      return stravaSummary;
    }
    return buildEstimatedHeartRateZoneSummary(selectedActivity?.splits, selectedActivity?.athleteMaxHeartrate ?? null);
  }, [selectedActivity?.heartRateZones, selectedActivity?.splits, selectedActivity?.athleteMaxHeartrate]);

  async function loadCalendarOptions(): Promise<void> {
    try {
      const options = await api.getCalendarFilterOptions();
      setCalendarOptions(options);
    } catch {
      setCalendarOptions({ years: [], monthsByYear: {} });
    }
  }

  useEffect(() => {
    void loadCalendarOptions();
  }, []);

  async function loadPersistedAnalysis(activityId: number): Promise<void> {
    setAnalysisStateById((current) => ({ ...current, [activityId]: 'loading' }));
    setAnalysisErrorById((current) => ({ ...current, [activityId]: null }));

    try {
      const response = await api.getActivityAnalysis(activityId);
      if (response) {
        setAnalysisById((current) => ({ ...current, [activityId]: response.content }));
        setAnalysisStateById((current) => ({ ...current, [activityId]: 'ready' }));
      } else {
        setAnalysisStateById((current) => ({ ...current, [activityId]: 'idle' }));
      }
    } catch (analysisError) {
      setAnalysisStateById((current) => ({ ...current, [activityId]: 'error' }));
      setAnalysisErrorById((current) => ({
        ...current,
        [activityId]: analysisError instanceof Error ? analysisError.message : '分析数据加载失败',
      }));
    }
  }

  async function openActivity(id: number, loadAnalysis = true): Promise<RunActivity | null> {
    setDrawerState('loading');
    setDrawerError(null);

    try {
      const detail = await api.getActivity(id);
      setSelectedActivity(detail);
      setDrawerState('ready');
      if (loadAnalysis) {
        void loadPersistedAnalysis(id);
      }
      return detail;
    } catch (detailError) {
      setDrawerState('error');
      setDrawerError(detailError instanceof Error ? detailError.message : '加载详情失败');
      return null;
    }
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
    const detail = await openActivity(activityId, false);
    if (!detail) {
      return;
    }
    await generateAnalysis(activityId);
  }

  async function syncLatest(): Promise<void> {
    setSyncState('loading');
    setSyncMessage(null);
    try {
      const result = await api.syncLatest();
      setSyncState('ready');
      setSyncMessage(
        `同步完成：新增 ${result.created} 条，更新 ${result.updated} 条，失败 ${result.failed} 条。` +
          `（按 strava_id 幂等写入，不会重复导入）`,
      );
      setPage(1);
      setRefreshKey((current) => current + 1);
      await loadCalendarOptions();
    } catch (syncError) {
      setSyncState('error');
      setSyncMessage(syncError instanceof Error ? syncError.message : '同步失败');
    }
  }

  async function generatePeriodAnalysis(period: PeriodAnalysisPeriod): Promise<void> {
    setPeriodAnalysisPeriod(period);
    setPeriodAnalysisState('loading');
    setPeriodAnalysisError(null);
    try {
      const result = await api.generatePeriodAnalysis(period);
      setPeriodAnalysisContent(result.content);
      setPeriodAnalysisRange({ from: result.from, to: result.to });
      setPeriodAnalysisState('ready');
    } catch (analysisError) {
      setPeriodAnalysisState('error');
      setPeriodAnalysisError(analysisError instanceof Error ? analysisError.message : '周期分析生成失败');
    }
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
          <button className="ghost-btn" onClick={() => void syncLatest()} disabled={syncState === 'loading'}>
            {syncState === 'loading' ? '同步中...' : '手动同步最新数据'}
          </button>
          {syncMessage ? <div className={`sync-status ${syncState === 'error' ? 'error' : 'ok'}`}>{syncMessage}</div> : null}
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
        <div className="period-analysis-header">
          <h2>周期AI分析（实时生成）</h2>
          <div className="period-analysis-actions">
            <button className="analysis-btn" onClick={() => void generatePeriodAnalysis('week')} disabled={periodAnalysisState === 'loading'}>
              按周分析
            </button>
            <button className="analysis-btn" onClick={() => void generatePeriodAnalysis('month')} disabled={periodAnalysisState === 'loading'}>
              按月分析
            </button>
            <button className="analysis-btn" onClick={() => void generatePeriodAnalysis('year')} disabled={periodAnalysisState === 'loading'}>
              按年分析
            </button>
          </div>
        </div>
        {periodAnalysisState === 'loading' ? <div className="empty-box">AI 正在生成周期分析...</div> : null}
        {periodAnalysisState === 'error' ? <div className="error-banner">{periodAnalysisError ?? '周期分析生成失败'}</div> : null}
        {periodAnalysisRange ? (
          <p className="period-analysis-meta">
            周期：{periodAnalysisPeriod === 'week' ? '本周' : periodAnalysisPeriod === 'month' ? '本月' : '本年'}（
            {periodAnalysisRange.from} ~ {periodAnalysisRange.to}）
          </p>
        ) : null}
        {periodAnalysisContent ? <pre className="analysis-content">{periodAnalysisContent}</pre> : null}
        {!periodAnalysisContent && periodAnalysisState !== 'loading' ? (
          <div className="empty-box">点击“按周/按月/按年分析”实时生成，不会保存历史结果。</div>
        ) : null}
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
                  <th>设备</th>
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
                  <th>平均心率</th>
                  <th>最高心率</th>
                  <th>卡路里</th>
                  <th>平均步频</th>
                  <th>AI分析</th>
                </tr>
              </thead>
              <tbody>
                {activities.items.map((item) => (
                  <tr key={item.stravaId} onClick={() => void openActivity(item.stravaId)} className="click-row">
                    <td>{formatDateTime(item.startDateLocal)}</td>
                    <td>{item.name}</td>
                    <td>{item.deviceName ?? '--'}</td>
                    <td>{formatDistance(item.distanceM)}</td>
                    <td>{formatDuration(item.movingTimeS)}</td>
                    <td>{formatPace(item.paceSecPerKm)}</td>
                    <td>{formatElevation(item.totalElevationGainM)}</td>
                    <td>{formatHeartRate(item.averageHeartrate)}</td>
                    <td>{formatHeartRate(item.maxHeartrate)}</td>
                    <td>{formatCalories(item.calories ?? null)}</td>
                    <td>{formatCadence(item.averageCadence)}</td>
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
          <button className="ghost-btn" onClick={() => setSelectedActivity(null)}>
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
                    <LineChart data={detailTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="elapsedTimeS" tickFormatter={formatElapsedAxisLabel} minTickGap={24} />
                      <YAxis />
                      <Tooltip content={<DetailTrendTooltip />} />
                      <Line type="monotone" dataKey="heartrate" stroke="#de4d3e" name="心率" strokeWidth={2.5} connectNulls dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </section>
                <section className="trend-chart-card">
                  <h5>配速趋势</h5>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={detailTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="elapsedTimeS" tickFormatter={formatElapsedAxisLabel} minTickGap={24} />
                      <YAxis />
                      <Tooltip content={<DetailTrendTooltip />} />
                      <Line type="monotone" dataKey="paceSecPerKm" stroke="#0e8892" name="配速" strokeWidth={2.5} connectNulls dot={false} />
                    </LineChart>
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
                <div className="empty-box">点击列表中的“AI分析”按钮来生成分析。</div>
              ) : null}
            </section>

            <h4>分段配速</h4>
            {selectedActivity.splits && selectedActivity.splits.length > 0 ? (
              <div className="table-wrap split-table">
                <table>
                  <thead>
                    <tr>
                      <th>公里段</th>
                      <th>距离</th>
                      <th>时间</th>
                      <th>配速</th>
                      <th>心率</th>
                      <th>卡路里</th>
                      <th>步频</th>
                      <th>海拔变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedActivity.splits.map((split) => (
                      <tr key={split.splitIndex}>
                        <td>{split.splitIndex}</td>
                        <td>{formatDistance(split.distanceM)}</td>
                        <td>{formatDuration(split.elapsedTimeS)}</td>
                        <td>{formatPace(split.paceSecPerKm)}</td>
                        <td>{formatHeartRate(split.averageHeartrate)}</td>
                        <td>{formatCalories(split.calories)}</td>
                        <td>{formatCadence(split.averageCadence)}</td>
                        <td>{split.elevationDifferenceM == null ? '--' : `${split.elevationDifferenceM.toFixed(1)} m`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-box">暂无分段数据</div>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
