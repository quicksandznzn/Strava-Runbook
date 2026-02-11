import type { DailySummary } from '../../../shared/types.js';

export interface DayCellProps {
  summary: DailySummary;
  isCurrentMonth: boolean;
  isToday: boolean;
  onClick: () => void;
}

export function DayCell({ summary, isCurrentMonth, isToday, onClick }: DayCellProps) {
  const dayNumber = Number(summary.date.split('-')[2]);
  const runCount = summary.activities.length;

  const planPreview = summary.plan?.planText || null;

  const statusClass = summary.completionStatus === 'completed'
    ? 'completed'
    : summary.completionStatus === 'missed'
    ? 'missed'
    : 'no_plan';

  return (
    <div
      className={`day-cell ${statusClass} ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
      onClick={onClick}
    >
      <div className="day-number">{dayNumber}</div>
      {planPreview && <div className="plan-preview">{planPreview}</div>}
      {runCount > 0 && (
        <div className="run-badge">
          🏃 {runCount}
        </div>
      )}
    </div>
  );
}
