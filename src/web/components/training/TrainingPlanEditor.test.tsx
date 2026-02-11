import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TrainingPlanEditor } from './TrainingPlanEditor.js';
import type { TrainingPlan } from '../../../shared/types.js';

describe('TrainingPlanEditor', () => {
  const mockDate = '2026-01-15';

  it('renders with empty initial state when no plan exists', () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    expect(screen.getByText('训练计划')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入今日训练计划/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.queryByText('删除')).not.toBeInTheDocument();
  });

  it('renders with existing plan data', () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const textarea = screen.getByPlaceholderText(/输入今日训练计划/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('轻松跑 10km');
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('resets text when switching to a date without plan', () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn();

    const { rerender } = render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);
    const textarea = screen.getByPlaceholderText(/输入今日训练计划/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('轻松跑 10km');

    rerender(<TrainingPlanEditor date="2026-01-16" initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    expect(textarea.value).toBe('');
    expect(screen.queryByText('删除')).not.toBeInTheDocument();
  });

  it('enables save button when text is entered', () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/输入今日训练计划/);
    fireEvent.change(textarea, { target: { value: '间歇跑 8x400m' } });

    expect(saveButton).not.toBeDisabled();
  });

  it('calls onSave with plan text when save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    const textarea = screen.getByPlaceholderText(/输入今日训练计划/);
    fireEvent.change(textarea, { target: { value: 'LSD 15km' } });

    const saveButton = screen.getByRole('button', { name: '保存' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('LSD 15km');
    });
  });

  it('shows loading state during save', async () => {
    const onSave = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    const textarea = screen.getByPlaceholderText(/输入今日训练计划/);
    fireEvent.change(textarea, { target: { value: '测试计划' } });

    const saveButton = screen.getByRole('button', { name: '保存' });
    fireEvent.click(saveButton);

    expect(screen.getByText('保存中...')).toBeInTheDocument();
    expect(textarea).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByText('保存')).toBeInTheDocument();
    });
  });

  it('does not call onSave if text is empty or whitespace only', async () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={null} onSave={onSave} onDelete={onDelete} />);

    const textarea = screen.getByPlaceholderText(/输入今日训练计划/);
    fireEvent.change(textarea, { target: { value: '   ' } });

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();
  });

  it('shows delete confirmation dialog', () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);

    expect(screen.getByText('确认删除？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('cancels delete confirmation', () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn();

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);

    const cancelButton = screen.getByRole('button', { name: '取消' });
    fireEvent.click(cancelButton);

    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('calls onDelete when delete is confirmed', async () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: '确认' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('clears text after successful delete', async () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: '确认' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/输入今日训练计划/) as HTMLTextAreaElement;
      expect(textarea.value).toBe('');
    });
  });

  it('shows loading state during delete', async () => {
    const plan: TrainingPlan = {
      id: 1,
      date: mockDate,
      planText: '轻松跑 10km',
      createdAt: '2026-01-14T10:00:00Z',
      updatedAt: '2026-01-14T10:00:00Z',
    };

    const onSave = vi.fn();
    const onDelete = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(<TrainingPlanEditor date={mockDate} initialPlan={plan} onSave={onSave} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: '确认' });
    fireEvent.click(confirmButton);

    expect(confirmButton).toBeDisabled();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });
});
