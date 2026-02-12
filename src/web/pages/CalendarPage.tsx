import { useState } from 'react';
import { CalendarGrid } from '../components/calendar/CalendarGrid.js';
import { CalendarHeader } from '../components/calendar/CalendarHeader.js';
import { DayDetailPanel } from '../components/calendar/DayDetailPanel.js';

export function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handlePrevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function handleNextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  function handleToday() {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }

  function handlePlanChange() {
    setRefreshKey((prev) => prev + 1);
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="hero-kicker">TRAINING CALENDAR</p>
          <h1>训练日历</h1>
          <p className="hero-subtitle">查看训练计划和完成情况，点击日期查看详情。</p>
        </div>
      </header>

      <section className="card">
        <CalendarHeader
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
        />

        <CalendarGrid
          year={year}
          month={month}
          onDateSelect={setSelectedDate}
          key={refreshKey}
        />
      </section>

      <DayDetailPanel
        date={selectedDate}
        onClose={() => setSelectedDate(null)}
        onPlanChange={handlePlanChange}
      />
    </div>
  );
}
