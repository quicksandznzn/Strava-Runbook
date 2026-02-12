import { useEffect, useState } from 'react';
import type { TrainingPlan } from '../../../shared/types.js';

export interface TrainingPlanEditorProps {
  date: string;
  initialPlan: TrainingPlan | null;
  onSave: (planText: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function TrainingPlanEditor({ date, initialPlan, onSave, onDelete }: TrainingPlanEditorProps) {
  const [planText, setPlanText] = useState(initialPlan?.planText || '');
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setPlanText(initialPlan?.planText || '');
    setShowDeleteConfirm(false);
  }, [date, initialPlan?.id, initialPlan?.planText]);

  async function handleSave() {
    if (!planText.trim()) {
      return;
    }

    setLoading(true);
    try {
      await onSave(planText);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await onDelete();
      setPlanText('');
      setShowDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="plan-editor">
      <h4>训练计划</h4>
      <textarea
        className="plan-textarea"
        value={planText}
        onChange={(e) => setPlanText(e.target.value)}
        placeholder="输入今日训练计划，如：轻松跑 10km，配速 6:00"
        rows={4}
        disabled={loading}
      />
      <div className="plan-editor-actions">
        <button
          className="ghost-btn"
          onClick={handleSave}
          disabled={loading || !planText.trim()}
        >
          {loading ? '保存中...' : '保存'}
        </button>
        {initialPlan && (
          <>
            {!showDeleteConfirm ? (
              <button
                className="ghost-btn delete-btn"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
              >
                删除
              </button>
            ) : (
              <div className="delete-confirm">
                <span>确认删除？</span>
                <button
                  className="ghost-btn"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  确认
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={loading}
                >
                  取消
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
