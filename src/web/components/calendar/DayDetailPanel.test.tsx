// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailySummary, RunActivity } from '../../../shared/types.js';
import { api } from '../../api.js';
import { DayDetailPanel } from './DayDetailPanel.js';

vi.mock('../../api.js', () => ({
  api: {
    getDailySummary: vi.fn(),
    createTrainingPlan: vi.fn(),
    updateTrainingPlan: vi.fn(),
    deleteTrainingPlan: vi.fn(),
  },
}));

vi.mock('../training/TrainingPlanEditor.js', () => ({
  TrainingPlanEditor: ({ date }: { date: string }) => <div data-testid="training-plan-editor">{date}</div>,
}));

function buildActivity(overrides: Partial<RunActivity> = {}): RunActivity {
  return {
    stravaId: 17300000001,
    name: '晨跑',
    startDateLocal: '2026-02-01T06:30:00Z',
    distanceM: 5000,
    movingTimeS: 1600,
    elapsedTimeS: 1700,
    totalElevationGainM: 20,
    averageSpeedMps: 3.1,
    maxSpeedMps: 3.8,
    paceSecPerKm: 320,
    averageHeartrate: null,
    maxHeartrate: null,
    averageCadence: null,
    sufferScore: null,
    mapSummaryPolyline: null,
    mapPolyline: null,
    updatedAt: '2026-02-01T08:00:00Z',
    ...overrides,
  };
}

describe('DayDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when selected day has no activities', async () => {
    const summaries: DailySummary[] = [
      {
        date: '2026-02-01',
        plan: null,
        activities: [],
        completionStatus: 'no_plan',
      },
    ];
    vi.mocked(api.getDailySummary).mockResolvedValue(summaries);

    render(<DayDetailPanel date="2026-02-01" onClose={vi.fn()} />);

    await waitFor(() => expect(api.getDailySummary).toHaveBeenCalledWith(2026, 2));
    expect(screen.getByText('当天跑步记录')).toBeInTheDocument();
    expect(screen.getByText('当天暂无跑步记录')).toBeInTheDocument();
  });

  it('shows a simple activity list for the selected day', async () => {
    const summaries: DailySummary[] = [
      {
        date: '2026-02-01',
        plan: null,
        activities: [
          buildActivity({
            stravaId: 17336665919,
            name: '傍晚跑步',
            startDateLocal: '2026-02-01T19:48:33Z',
            distanceM: 9200,
            movingTimeS: 3388,
            paceSecPerKm: 368,
          }),
        ],
        completionStatus: 'no_plan',
      },
    ];
    vi.mocked(api.getDailySummary).mockResolvedValue(summaries);

    render(<DayDetailPanel date="2026-02-01" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('傍晚跑步')).toBeInTheDocument());
    expect(screen.getByText('2026/02/01 19:48')).toBeInTheDocument();
    expect(screen.getByText('9.2 km')).toBeInTheDocument();
    expect(screen.getByText('56m 28s')).toBeInTheDocument();
    expect(screen.getByText('6:08 /km')).toBeInTheDocument();
  });
});
