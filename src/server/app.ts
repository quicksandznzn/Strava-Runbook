import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { ActivityAiAnalysis, ActivitySortBy, RunActivity, SortDirection } from '../shared/types.js';
import type { RunRepository } from '../db/repository.js';
import { runSync, type SyncStats } from '../cli/sync.js';

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

interface AppOptions {
  analyzeActivity?: (activity: RunActivity) => Promise<string>;
  syncActivities?: (input: { full?: boolean; from?: string }, repository: RunRepository) => Promise<SyncStats>;
}

export function createApp(repository: RunRepository, options: AppOptions = {}) {
  const app = express();
  let syncInProgress = false;
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
      const cached = repository.getActivityAnalysis(id);
      if (cached && !force) {
        res.json({ ...cached, cached: true });
        return;
      }

      if (!options.analyzeActivity) {
        res.status(501).json({ error: 'AI analysis is not configured on the server.' });
        return;
      }

      const activity = repository.getActivityById(id);
      if (!activity) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      const content = await options.analyzeActivity(activity);
      const payload: ActivityAiAnalysis = repository.saveActivityAnalysis(id, content);
      res.json(payload);
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
        const latest = repository.listActivities({
          page: 1,
          pageSize: 1,
          sortBy: 'start_date_local',
          sortDir: 'desc',
        }).items[0];
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
