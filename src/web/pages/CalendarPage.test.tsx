import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarPage } from './CalendarPage.js';

// Mock child components
vi.mock('../components/calendar/CalendarGrid.js', () => ({
  CalendarGrid: ({ year, month, onDateSelect }: { year: number; month: number; onDateSelect: (date: string) => void }) => (
    <div data-testid="calendar-grid">
      <div>Year: {year}</div>
      <div>Month: {month}</div>
      <button onClick={() => onDateSelect('2026-01-15')}>Select Date</button>
    </div>
  ),
}));

vi.mock('../components/calendar/CalendarHeader.js', () => ({
  CalendarHeader: ({
    year,
    month,
    onPrevMonth,
    onNextMonth,
    onToday,
  }: {
    year: number;
    month: number;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onToday: () => void;
  }) => (
    <div data-testid="calendar-header">
      <div>
        {year}-{String(month).padStart(2, '0')}
      </div>
      <button onClick={onPrevMonth}>Prev</button>
      <button onClick={onNextMonth}>Next</button>
      <button onClick={onToday}>Today</button>
    </div>
  ),
}));

vi.mock('../components/calendar/DayDetailPanel.js', () => ({
  DayDetailPanel: ({ date, onClose }: { date: string | null; onClose: () => void }) =>
    date ? (
      <div data-testid="day-detail-panel">
        <div>Selected: {date}</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // Jan 15, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders calendar page with header and grid', () => {
    render(<CalendarPage />);

    expect(screen.getByText('训练日历')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
  });

  it('initializes with current year and month', () => {
    render(<CalendarPage />);

    expect(screen.getByText('2026-01')).toBeInTheDocument();
  });

  it('navigates to previous month', () => {
    render(<CalendarPage />);

    const prevButton = screen.getByText('Prev');
    fireEvent.click(prevButton);

    expect(screen.getByText('2025-12')).toBeInTheDocument();
  });

  it('navigates to next month', () => {
    render(<CalendarPage />);

    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);

    expect(screen.getByText('2026-02')).toBeInTheDocument();
  });

  it('handles year boundary when going to previous month from January', () => {
    render(<CalendarPage />);

    const prevButton = screen.getByText('Prev');
    fireEvent.click(prevButton); // Dec 2025

    expect(screen.getByText('2025-12')).toBeInTheDocument();
  });

  it('handles year boundary when going to next month from December', () => {
    render(<CalendarPage />);

    // Navigate to December
    const nextButton = screen.getByText('Next');
    for (let i = 0; i < 11; i++) {
      fireEvent.click(nextButton);
    }

    expect(screen.getByText('2026-12')).toBeInTheDocument();

    // Go to next month (January 2027)
    fireEvent.click(nextButton);
    expect(screen.getByText('2027-01')).toBeInTheDocument();
  });

  it('navigates to today when today button is clicked', () => {
    render(<CalendarPage />);

    // Navigate away
    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);
    expect(screen.getByText('2026-03')).toBeInTheDocument();

    // Click today
    const todayButton = screen.getByText('Today');
    fireEvent.click(todayButton);

    expect(screen.getByText('2026-01')).toBeInTheDocument();
  });

  it('opens day detail panel when date is selected', () => {
    render(<CalendarPage />);

    expect(screen.queryByTestId('day-detail-panel')).not.toBeInTheDocument();

    const selectButton = screen.getByText('Select Date');
    fireEvent.click(selectButton);

    expect(screen.getByTestId('day-detail-panel')).toBeInTheDocument();
    expect(screen.getByText('Selected: 2026-01-15')).toBeInTheDocument();
  });

  it('closes day detail panel when close is clicked', () => {
    render(<CalendarPage />);

    // Open panel
    const selectButton = screen.getByText('Select Date');
    fireEvent.click(selectButton);

    expect(screen.getByTestId('day-detail-panel')).toBeInTheDocument();

    // Close panel
    const closeButton = screen.getByText('Close');
    fireEvent.click(closeButton);

    expect(screen.queryByTestId('day-detail-panel')).not.toBeInTheDocument();
  });
});
