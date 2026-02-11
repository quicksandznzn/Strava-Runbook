import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MapContainer, Polyline, TileLayer } from 'react-leaflet';
import polyline from '@mapbox/polyline';
import type { ActivitySortBy, CalendarFilterOptions, PaginatedActivities, RunActivity, SummaryMetrics, WeeklyTrendPoint } from '../shared/types.js';
import { api } from './api.js';
import { formatDateTime, formatDistance, formatDuration, formatElevation, formatHeartRate, formatPace } from './format.js';

const PAGE_SIZE = 20;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DateFilter {
  from?: string;
  to?: string;
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

  const { summary, trends, activities, state, error } = useQueryData(filters, page, sortBy, sortDir);

  const totalPages = Math.max(1, Math.ceil(activities.total / activities.pageSize));
  const availableMonths = quickYear ? calendarOptions.monthsByYear[String(quickYear)] ?? [] : [];

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

    try {
      const detail = await api.getActivity(id);
      setSelectedActivity(detail);
      setDrawerState('ready');
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
