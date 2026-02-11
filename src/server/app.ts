import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { ActivityAiAnalysis, ActivitySortBy, RunActivity, SortDirection, TrainingPlan } from '../shared/types.js';
import type { RunRepository } from '../db/repository.js';

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
}

export function createApp(repository: RunRepository, options: AppOptions = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get('/api/summary', (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const result = repository.getSummary({ from, to });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/trends/weekly', (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const result = repository.getWeeklyTrends({ from, to });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/filters/calendar', (_req, res, next) => {
    try {
      const result = repository.getCalendarFilterOptions();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities', (req, res, next) => {
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

      const result = repository.listActivities({ from, to, page, pageSize, sortBy, sortDir });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid activity id.' });
        return;
      }

      const activity = repository.getActivityById(id);
      if (!activity) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      res.json(activity);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/activities/:id/analysis', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid activity id.' });
        return;
      }

      const cached = repository.getActivityAnalysis(id);
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

      if (!options.analyzeActivity) {
        res.status(501).json({ error: 'AI analysis is not configured on the server.' });
        return;
      }

      const activity = repository.getActivityById(id);
      if (!activity) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      // Query the training plan for the activity date
      const date = activity.startDateLocal.split('T')[0];
      const plan = repository.getTrainingPlanByDate(date);
      const cached = repository.getActivityAnalysis(id);

      if (shouldUseCachedAnalysis(cached, force, plan)) {
        res.json({ ...cached, cached: true });
        return;
      }

      const rawContent = await options.analyzeActivity(activity, plan ?? undefined);
      const content = ensurePlanCompletionSection(rawContent, plan);
      const payload: ActivityAiAnalysis = repository.saveActivityAnalysis(id, content);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  // Training Plans API
  app.post('/api/training-plans', (req, res, next) => {
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

      const plan = repository.createTrainingPlan(date, planText);
      res.status(201).json(plan);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'A training plan already exists for this date.' });
        return;
      }
      next(error);
    }
  });

  app.get('/api/training-plans/:date', (req, res, next) => {
    try {
      const date = req.params.date;

      if (!isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const plan = repository.getTrainingPlanByDate(date);
      if (!plan) {
        res.status(404).json({ error: 'Training plan not found for this date.' });
        return;
      }

      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/training-plans/:date', (req, res, next) => {
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

      const plan = repository.updateTrainingPlan(date, planText);
      if (!plan) {
        res.status(404).json({ error: 'Training plan not found for this date.' });
        return;
      }

      res.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/training-plans/:date', (req, res, next) => {
    try {
      const date = req.params.date;

      if (!isValidDateInput(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const deleted = repository.deleteTrainingPlan(date);
      res.json({ deleted });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/training-plans', (req, res, next) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!isValidDateInput(from) || !isValidDateInput(to)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }

      const plans = repository.getTrainingPlansByRange(from, to);
      res.json(plans);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/calendar/daily-summary', (req, res, next) => {
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

      const summary = repository.getDailySummary(year, month);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  return app;
}
