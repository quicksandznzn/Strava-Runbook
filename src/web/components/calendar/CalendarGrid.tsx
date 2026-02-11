import { useEffect, useState } from 'react';
import type { DailySummary } from '../../../shared/types.js';
import { api } from '../../api.js';
import { DayCell } from './DayCell.js';

interface CalendarGridProps {
  year: number;
  month: number;
  onDateSelect: (date: string) => void;
}

function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCalendarDays(year: number, month: number, summaries: DailySummary[]): DailySummary[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const firstDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const summaryMap = new Map(summaries.map((s) => [s.date, s]));

  const days: DailySummary[] = [];

  // Previous month days
  const prevMonthLastDay = new Date(year, month - 1, 0);
  const prevMonthDaysCount = firstDayOfWeek;
  for (let i = prevMonthDaysCount - 1; i >= 0; i--) {
    const date = new Date(prevMonthLastDay);
    date.setDate(prevMonthLastDay.getDate() - i);
    const dateStr = formatLocalDateKey(date);
    days.push(
      summaryMap.get(dateStr) || {
        date: dateStr,
        plan: null,
        activities: [],
        completionStatus: 'no_plan',
      }
    );
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dateStr = formatLocalDateKey(date);
    days.push(
      summaryMap.get(dateStr) || {
        date: dateStr,
        plan: null,
        activities: [],
        completionStatus: 'no_plan',
      }
    );
  }

  // Next month days - only fill to complete the current week
  const totalDays = days.length;
  const remainingInWeek = totalDays % 7 === 0 ? 0 : 7 - (totalDays % 7);

  for (let day = 1; day <= remainingInWeek; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatLocalDateKey(date);
    days.push(
      summaryMap.get(dateStr) || {
        date: dateStr,
        plan: null,
        activities: [],
        completionStatus: 'no_plan',
      }
    );
  }

  return days;
}

export function CalendarGrid({ year, month, onDateSelect }: CalendarGridProps) {
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getDailySummary(year, month);
        if (!cancelled) {
          setSummaries(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载日历数据失败');
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [year, month]);

  if (loading) {
    return <div className="empty-box">加载中...</div>;
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  const days = buildCalendarDays(year, month, summaries);
  const today = formatLocalDateKey(new Date());
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="calendar-grid-container">
      <div className="calendar-weekdays">
        {weekDays.map((day) => (
          <div key={day} className="weekday-header">
            {day}
          </div>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((summary) => {
          const summaryMonth = Number(summary.date.split('-')[1]);
          const isCurrentMonth = summaryMonth === month;
          const isToday = summary.date === today;

          return (
            <DayCell
              key={summary.date}
              summary={summary}
              isCurrentMonth={isCurrentMonth}
              isToday={isToday}
              onClick={() => onDateSelect(summary.date)}
            />
          );
        })}
      </div>
    </div>
  );
}
