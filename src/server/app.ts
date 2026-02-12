import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import type {
  ActivityAiAnalysis,
  ActivitySortBy,
  PeriodAnalysisPeriod,
  PeriodAnalysisResult,
  RunActivity,
  SortDirection,
  SummaryMetrics,
  TrainingPlan,
} from '../shared/types.js';
import type { RunRepository } from '../db/repository.js';
import { runSync, type SyncStats } from '../cli/sync.js';

const DEFAULT_ATHLETE_MAX_HEARTRATE = 186;
const activityDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function isValidDateInput(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeSortBy(input: string | undefined): ActivitySortBy {
  if (input === 'distance_m' || input === 'pace_sec_per_km') {
    return input;
  }
  return 'start_date_local';
}

function normalizeSortDir(input: string | undefined): SortDirection {
  return input === 'asc' ? 'asc' : 'desc';
}

function normalizePeriod(input: string | undefined): PeriodAnalysisPeriod | null {
  if (input === 'week' || input === 'month' || input === 'year') {
    return input;
  }
  return null;
}

function resolveConfiguredAthleteMaxHeartrate(): number | null {
  const raw = process.env.ATHLETE_MAX_HEARTRATE;
  if (!raw) {
    return DEFAULT_ATHLETE_MAX_HEARTRATE;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_ATHLETE_MAX_HEARTRATE;
  }
  return Math.round(value);
}

function toDateString(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toActivityDate(value: string): string {
  return activityDateFormatter.format(new Date(value));
}

function getPeriodRangeInShanghai(period: PeriodAnalysisPeriod, now: Date = new Date()): { from: string; to: string } {
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const shanghaiNow = new Date(now.getTime() + shanghaiOffsetMs);
  const today = new Date(Date.UTC(shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), shanghaiNow.getUTCDate()));

  let from = today;
  if (period === 'week') {
    const day = today.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    from = new Date(today.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
  } else if (period === 'month') {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  } else {
    from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  }

  return {
    from: toDateString(from),
    to: toDateString(today),
  };
}

function shouldUseCachedAnalysis(
  cached: ActivityAiAnalysis | null,
  force: boolean,
  plan: TrainingPlan | null,
): cached is ActivityAiAnalysis {
  if (!cached || force) {
    return false;
  }
  if (!plan) {
    return true;
  }

  if (!cached.content.includes('## 计划完成度')) {
    return false;
  }

  const generatedAt = Date.parse(cached.generatedAt);
  const planUpdatedAt = Date.parse(plan.updatedAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(planUpdatedAt)) {
    return true;
  }

  return generatedAt >= planUpdatedAt;
}

function ensurePlanCompletionSection(content: string, plan: TrainingPlan | null): string {
  if (!plan) {
    return content;
  }

  if (content.includes('## 计划完成度')) {
    return content;
  }

  const suffix = [
    '',
    '## 计划完成度',
    `训练计划：${plan.planText}`,
    '本次分析已关联训练计划，请结合当次跑步数据评估完成情况。',
  ].join('\n');

  return `${content.trimEnd()}\n${suffix}\n`;
}

interface AppOptions {
  analyzeActivity?: (activity: RunActivity, plan?: TrainingPlan) => Promise<string>;
  analyzePeriod?: (input: {
    period: PeriodAnalysisPeriod;
    from: string;
    to: string;
    summary: SummaryMetrics;
    recentRuns: RunActivity[];
  }) => Promise<string>;
  syncActivities?: (input: { full?: boolean; from?: string }, repository: RunRepository) => Promise<SyncStats>;
}

export function createApp(repository: RunRepository, options: AppOptions = {}) {
  const app = express();
  const configuredAthleteMaxHeartrate = resolveConfiguredAthleteMaxHeartrate();
  let syncInProgress = false;
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get('/api/summary', async (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const result = await repository.getSummary({ from, to });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/trends/weekly', async (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const result = await repository.getWeeklyTrends({ from, to });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/filters/calendar', async (_req, res, next) => {
    try {
      const result = await repository.getCalendarFilterOptions();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities', async (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const sortBy = normalizeSortBy(req.query.sortBy as string | undefined);
      const sortDir = normalizeSortDir(req.query.sortDir as string | undefined);

      const result = await repository.listActivities({ from, to, page, pageSize, sortBy, sortDir });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid activity id.' });
        return;
      }

      const activity = await repository.getActivityById(id);
      if (!activity) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      res.json({
        ...activity,
        athleteMaxHeartrate: configuredAthleteMaxHeartrate ?? activity.athleteMaxHeartrate ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities/:id/analysis', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid activity id.' });
        return;
      }

      const cached = await repository.getActivityAnalysis(id);
      if (!cached) {
        res.status(404).json({ error: 'No analysis yet for this activity.' });
        return;
      }

      res.json({ ...cached, cached: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/activities/:id/analysis', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid activity id.' });
        return;
      }

      const force = Boolean(req.body?.force);

      const activity = await repository.getActivityById(id);
      if (!activity) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      const date = toActivityDate(activity.startDateLocal);
      const [plan, cached] = await Promise.all([
        repository.getTrainingPlanByDate(date),
        repository.getActivityAnalysis(id),
      ]);

      if (shouldUseCachedAnalysis(cached, force, plan)) {
        res.json({ ...cached, cached: true });
        return;
      }

      if (!options.analyzeActivity) {
        res.status(501).json({ error: 'AI analysis is not configured on the server.' });
        return;
      }

      const rawContent = await options.analyzeActivity(activity, plan ?? undefined);
      const content = ensurePlanCompletionSection(rawContent, plan);
      const payload: ActivityAiAnalysis = await repository.saveActivityAnalysis(id, content);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analysis/period', async (req, res, next) => {
    try {
      const period = normalizePeriod(req.body?.period as string | undefined);
      if (!period) {
        res.status(400).json({ error: 'Invalid period. Use week, month, or year.' });
        return;
      }

      if (!options.analyzePeriod) {
        res.status(501).json({ error: 'AI period analysis is not configured on the server.' });
        return;
      }

      const range = getPeriodRangeInShanghai(period);
      const summary = await repository.getSummary(range);
      if (summary.totalRuns === 0) {
        const payload: PeriodAnalysisResult = {
          period,
          from: range.from,
          to: range.to,
          generatedAt: new Date().toISOString(),
          content: `## 周期总结\n${range.from} 到 ${range.to} 暂无跑步数据。\n\n## 训练亮点\n当前周期暂无可分析样本。\n\n## 风险提示\n若连续多周期无训练，建议从低强度恢复。\n\n## 下阶段建议\n1. 先安排每周 2-3 次轻松跑。\n2. 逐步增加单次时长。\n3. 记录心率与配速，便于后续分析。`,
        };
        res.json(payload);
        return;
      }

      const recentRuns = (
        await repository.listActivities({
          from: range.from,
          to: range.to,
          page: 1,
          pageSize: 20,
          sortBy: 'start_date_local',
          sortDir: 'desc',
        })
      ).items;

      const content = await options.analyzePeriod({
        period,
        from: range.from,
        to: range.to,
        summary,
        recentRuns,
      });

      const payload: PeriodAnalysisResult = {
        period,
        from: range.from,
        to: range.to,
        content,
        generatedAt: new Date().toISOString(),
      };
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/training-plans', async (req, res, next) => {
    try {
      const { date, planText } = req.body;

      if (!date || !isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid or missing date. Use YYYY-MM-DD format.' });
        return;
      }

      if (!planText || typeof planText !== 'string' || planText.trim() === '') {
        res.status(400).json({ error: 'planText is required and must be a non-empty string.' });
        return;
      }

      const plan = await repository.createTrainingPlan(date, planText);
      res.status(201).json(plan);
    } catch (error) {
      const pgError = error as { code?: string; message?: string };
      if (pgError.code === '23505') {
        res.status(409).json({ error: 'A training plan already exists for this date.' });
        return;
      }
      next(error);
    }
  });

  app.get('/api/training-plans/:date', async (req, res, next) => {
    try {
      const date = req.params.date;

      if (!isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const plan = await repository.getTrainingPlanByDate(date);
      if (!plan) {
        res.status(404).json({ error: 'Training plan not found for this date.' });
        return;
      }

      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/training-plans/:date', async (req, res, next) => {
    try {
      const date = req.params.date;
      const { planText } = req.body;

      if (!isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      if (!planText || typeof planText !== 'string' || planText.trim() === '') {
        res.status(400).json({ error: 'planText is required and must be a non-empty string.' });
        return;
      }

      const plan = await repository.updateTrainingPlan(date, planText);
      if (!plan) {
        res.status(404).json({ error: 'Training plan not found for this date.' });
        return;
      }

      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/training-plans/:date', async (req, res, next) => {
    try {
      const date = req.params.date;

      if (!isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const deleted = await repository.deleteTrainingPlan(date);
      res.json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/training-plans', async (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const plans = await repository.getTrainingPlansByRange(from, to);
      res.json(plans);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/calendar/daily-summary', async (req, res, next) => {
    try {
      const year = Number(req.query.year);
      const month = Number(req.query.month);

      if (!Number.isFinite(year) || !Number.isInteger(year)) {
        res.status(400).json({ error: 'year is required and must be an integer.' });
        return;
      }

      if (!Number.isFinite(month) || !Number.isInteger(month) || month < 1 || month > 12) {
        res.status(400).json({ error: 'month is required and must be an integer between 1 and 12.' });
        return;
      }

      const summary = await repository.getDailySummary(year, month);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sync', async (req, res, next) => {
    if (syncInProgress) {
      res.status(409).json({ error: 'Sync already in progress.' });
      return;
    }

    try {
      const full = Boolean(req.body?.full);
      const requestedFrom = req.body?.from as string | undefined;

      if (requestedFrom && !isValidDateInput(requestedFrom)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      let from = requestedFrom;
      if (!full && !from) {
        const latest = (
          await repository.listActivities({
            page: 1,
            pageSize: 1,
            sortBy: 'start_date_local',
            sortDir: 'desc',
          })
        ).items[0];
        from = latest?.startDateLocal.slice(0, 10) ?? '1970-01-01';
      }

      const syncActivities = options.syncActivities ?? runSync;
      syncInProgress = true;
      const stats = await syncActivities({ full, from }, repository);
      res.json({
        ...stats,
        mode: full ? 'full' : 'incremental',
        from,
      });
    } catch (error) {
      next(error);
    } finally {
      syncInProgress = false;
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  return app;
}
