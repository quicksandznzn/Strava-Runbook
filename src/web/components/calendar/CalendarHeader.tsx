interface CalendarHeaderProps {
  year: number;
  month: number;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

export function CalendarHeader({
  year,
  month,
  onYearChange,
  onMonthChange,
  onPrevMonth,
  onNextMonth,
  onToday,
}: CalendarHeaderProps) {
  const years = Array.from({ length: 11 }, (_, i) => 2020 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="calendar-header">
      <div className="calendar-header-controls">
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="calendar-select"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="calendar-select"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
      </div>

      <div className="calendar-header-nav">
        <button className="ghost-btn" onClick={onPrevMonth}>
          ← 上月
        </button>
        <button className="ghost-btn" onClick={onToday}>
          今天
        </button>
        <button className="ghost-btn" onClick={onNextMonth}>
          下月 →
        </button>
      </div>
    </div>
  );
}
