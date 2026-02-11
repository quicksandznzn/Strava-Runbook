import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from './schema.js';
import { createRepository } from './repository.js';
import type { RunRepository } from './repository.js';

describe('Training Plans Repository', () => {
  let db: Database.Database;
  let repository: RunRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    repository = createRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createTrainingPlan', () => {
    it('should create a new training plan', () => {
      const plan = repository.createTrainingPlan('2024-12-25', '轻松跑 10km');

      expect(plan).toMatchObject({
        id: expect.any(Number),
        date: '2024-12-25',
        planText: '轻松跑 10km',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('should throw error when creating duplicate plan for same date', () => {
      repository.createTrainingPlan('2024-12-25', '轻松跑 10km');

      expect(() => {
        repository.createTrainingPlan('2024-12-25', '间歇跑 8km');
      }).toThrow();
    });
  });

  describe('getTrainingPlanByDate', () => {
    it('should return plan if exists', () => {
      const created = repository.createTrainingPlan('2024-12-25', '轻松跑 10km');
      const fetched = repository.getTrainingPlanByDate('2024-12-25');

      expect(fetched).toEqual(created);
    });

    it('should return null if plan does not exist', () => {
      const result = repository.getTrainingPlanByDate('2024-12-25');

      expect(result).toBeNull();
    });
  });

  describe('updateTrainingPlan', () => {
    it('should update existing plan', () => {
      repository.createTrainingPlan('2024-12-25', '轻松跑 10km');
      const updated = repository.updateTrainingPlan('2024-12-25', '间歇跑 8km');

      expect(updated).toMatchObject({
        date: '2024-12-25',
        planText: '间歇跑 8km',
      });
    });

    it('should return null if plan does not exist', () => {
      const result = repository.updateTrainingPlan('2024-12-25', '轻松跑 10km');

      expect(result).toBeNull();
    });

    it('should update updatedAt timestamp', () => {
      const created = repository.createTrainingPlan('2024-12-25', '轻松跑 10km');

      // 等待至少 1ms
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      return delay(10).then(() => {
        const updated = repository.updateTrainingPlan('2024-12-25', '间歇跑 8km');

        expect(updated!.updatedAt).not.toBe(created.updatedAt);
      });
    });
  });

  describe('deleteTrainingPlan', () => {
    it('should delete existing plan', () => {
      repository.createTrainingPlan('2024-12-25', '轻松跑 10km');
      const deleted = repository.deleteTrainingPlan('2024-12-25');

      expect(deleted).toBe(true);

      const fetched = repository.getTrainingPlanByDate('2024-12-25');
      expect(fetched).toBeNull();
    });

    it('should return false if plan does not exist', () => {
      const result = repository.deleteTrainingPlan('2024-12-25');

      expect(result).toBe(false);
    });
  });

  describe('getTrainingPlansByRange', () => {
    beforeEach(() => {
      repository.createTrainingPlan('2024-12-20', '轻松跑 5km');
      repository.createTrainingPlan('2024-12-22', '间歇跑 8km');
      repository.createTrainingPlan('2024-12-25', '长距离 15km');
      repository.createTrainingPlan('2024-12-28', '恢复跑 3km');
    });

    it('should return all plans when no range specified', () => {
      const plans = repository.getTrainingPlansByRange();

      expect(plans).toHaveLength(4);
    });

    it('should return plans within date range', () => {
      const plans = repository.getTrainingPlansByRange('2024-12-22', '2024-12-25');

      expect(plans).toHaveLength(2);
      expect(plans.map((p) => p.date)).toEqual(['2024-12-25', '2024-12-22']);
    });

    it('should return plans from start date', () => {
      const plans = repository.getTrainingPlansByRange('2024-12-25');

      expect(plans).toHaveLength(2);
      expect(plans.map((p) => p.date)).toEqual(['2024-12-28', '2024-12-25']);
    });

    it('should return plans until end date', () => {
      const plans = repository.getTrainingPlansByRange(undefined, '2024-12-22');

      expect(plans).toHaveLength(2);
      expect(plans.map((p) => p.date)).toEqual(['2024-12-22', '2024-12-20']);
    });
  });

  describe('getDailySummary', () => {
    beforeEach(() => {
      // 创建训练计划
      repository.createTrainingPlan('2024-12-20', '轻松跑 5km');
      repository.createTrainingPlan('2024-12-25', '长距离 15km');

      // 创建跑步活动
      repository.upsertRunActivity({
        stravaId: 1,
        name: '晨跑',
        startDateLocal: '2024-12-20T07:00:00Z',
        distanceM: 5000,
        movingTimeS: 1500,
        elapsedTimeS: 1600,
        totalElevationGainM: 50,
        averageSpeedMps: 3.33,
        maxSpeedMps: 4.0,
        averageHeartrate: 150,
        maxHeartrate: 165,
        averageCadence: 170,
        sufferScore: 45,
        mapSummaryPolyline: null,
        mapPolyline: null,
        rawJson: '{}',
        splits: [],
      });
    });

    it('should return daily summary for a month', () => {
      const summary = repository.getDailySummary(2024, 12);

      expect(summary).toHaveLength(31); // December has 31 days

      // 检查 2024-12-20：有计划 + 有跑步 = completed
      const dec20 = summary.find((s) => s.date === '2024-12-20');
      expect(dec20).toMatchObject({
        date: '2024-12-20',
        plan: { date: '2024-12-20', planText: '轻松跑 5km' },
        activities: [{ stravaId: 1 }],
        completionStatus: 'completed',
      });

      // 检查 2024-12-25：有计划 + 无跑步 = missed
      const dec25 = summary.find((s) => s.date === '2024-12-25');
      expect(dec25).toMatchObject({
        date: '2024-12-25',
        plan: { date: '2024-12-25', planText: '长距离 15km' },
        activities: [],
        completionStatus: 'missed',
      });

      // 检查 2024-12-01：无计划 = no_plan
      const dec01 = summary.find((s) => s.date === '2024-12-01');
      expect(dec01).toMatchObject({
        date: '2024-12-01',
        plan: null,
        activities: [],
        completionStatus: 'no_plan',
      });
    });

    it('should include February 28 for non-leap year', () => {
      const summary = repository.getDailySummary(2025, 2);

      expect(summary).toHaveLength(28);
      expect(summary.some((s) => s.date === '2025-02-28')).toBe(true);
      expect(summary.some((s) => s.date === '2025-03-01')).toBe(false);
    });

    it('should handle multiple activities on same day', () => {
      // 添加第二次跑步
      repository.upsertRunActivity({
        stravaId: 2,
        name: '午跑',
        startDateLocal: '2024-12-20T12:00:00Z',
        distanceM: 3000,
        movingTimeS: 900,
        elapsedTimeS: 950,
        totalElevationGainM: 30,
        averageSpeedMps: 3.33,
        maxSpeedMps: 4.0,
        averageHeartrate: 145,
        maxHeartrate: 160,
        averageCadence: 168,
        sufferScore: 30,
        mapSummaryPolyline: null,
        mapPolyline: null,
        rawJson: '{}',
        splits: [],
      });

      const summary = repository.getDailySummary(2024, 12);
      const dec20 = summary.find((s) => s.date === '2024-12-20');

      expect(dec20!.activities).toHaveLength(2);
      expect(dec20!.completionStatus).toBe('completed');
    });
  });
});
