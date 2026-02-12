import { useEffect, useState } from 'react';
import type { DailySummary, TrainingPlan } from '../../../shared/types.js';
import { api } from '../../api.js';
import { formatDateTime, formatDistance, formatDuration, formatPace } from '../../format.js';
import { TrainingPlanEditor } from '../training/TrainingPlanEditor.js';

interface DayDetailPanelProps {
  date: string | null;
  onClose: () => void;
  onPlanChange?: () => void;
}

export function DayDetailPanel({ date, onClose, onPlanChange }: DayDetailPanelProps) {
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) {
      return;
    }
    const targetDate: string = date;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSummary(null);

      try {
        const [year, month] = targetDate.split('-').map(Number);
        const summaries = await api.getDailySummary(year, month);
        if (!cancelled) {
          const daySummary = summaries.find((s) => s.date === targetDate);
          setSummary(daySummary || null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载日期详情失败');
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [date]);

  async function handleSavePlan(planText: string) {
    if (!summary) {
      return;
    }
    const targetDate = summary.date;

    try {
      let updatedPlan: TrainingPlan;
      if (summary.plan) {
        updatedPlan = await api.updateTrainingPlan(targetDate, planText);
      } else {
        updatedPlan = await api.createTrainingPlan(targetDate, planText);
      }

      setSummary({
        ...summary,
        plan: updatedPlan,
      });

      // 通知父组件刷新日历
      onPlanChange?.();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '保存训练计划失败');
    }
  }

  async function handleDeletePlan() {
    if (!summary || !summary.plan) {
      return;
    }
    const targetDate = summary.date;

    try {
      await api.deleteTrainingPlan(targetDate);
      setSummary({
        ...summary,
        plan: null,
      });

      // 通知父组件刷新日历
      onPlanChange?.();
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '删除训练计划失败');
    }
  }

  const isOpen = date !== null;

  return (
    <aside className={`drawer ${isOpen ? 'open' : ''}`}>
      <div className="drawer-header">
        <h3>日期详情</h3>
        <button className="ghost-btn" onClick={onClose}>
          关闭
        </button>
      </div>

      {loading && <div className="empty-box">加载中...</div>}
      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="drawer-content">
          <h4>{summary.date}</h4>

          <section className="day-activities">
            <h4>当天跑步记录</h4>
            {summary.activities.length === 0 ? (
              <div className="empty-box">当天暂无跑步记录</div>
            ) : (
              <div className="activity-list">
                {summary.activities
                  .slice()
                  .sort((a, b) => b.startDateLocal.localeCompare(a.startDateLocal))
                  .map((activity) => (
                    <article key={activity.stravaId} className="activity-item">
                      <div className="activity-item-header">
                        <strong>{activity.name}</strong>
                        <span className="activity-time">{formatDateTime(activity.startDateLocal)}</span>
                      </div>
                      <div className="activity-item-stats">
                        <span>{formatDistance(activity.distanceM)}</span>
                        <span>{formatDuration(activity.movingTimeS)}</span>
                        <span>{formatPace(activity.paceSecPerKm)}</span>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>

          <TrainingPlanEditor
            date={summary.date}
            initialPlan={summary.plan}
            onSave={handleSavePlan}
            onDelete={handleDeletePlan}
          />
        </div>
      )}
    </aside>
  );
}
