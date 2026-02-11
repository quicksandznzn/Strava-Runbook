import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunActivity, TrainingPlan } from '../shared/types.js';

interface AnalyzeOptions {
  cwd?: string;
  timeoutMs?: number;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatPace(paceSecPerKm: number | null): string {
  if (!paceSecPerKm || !Number.isFinite(paceSecPerKm)) {
    return '--';
  }
  const rounded = Math.round(paceSecPerKm);
  const min = Math.floor(rounded / 60);
  const sec = rounded % 60;
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

function buildPrompt(activity: RunActivity, plan?: TrainingPlan): string {
  const splitsSummary =
    activity.splits && activity.splits.length > 0
      ? activity.splits
          .slice(0, 8)
          .map((split) => {
            const pace = split.paceSecPerKm ? `${Math.round(split.paceSecPerKm)}s/km` : '--';
            return `- 第${split.splitIndex}公里: ${Math.round(split.distanceM)}m, ${split.elapsedTimeS}s, 配速${pace}`;
          })
          .join('\n')
      : '- 无分段数据';

  const parts = [
    '你是专业跑步教练。请基于这次跑步数据给出中文分析。',
    plan
      ? '输出格式必须是 Markdown，包含以下 5 个标题：'
      : '输出格式必须是 Markdown，包含以下 4 个标题：',
    '## 本次总结',
    '## 亮点',
    '## 风险提示',
  ];

  if (plan) {
    parts.push('## 计划完成度');
  }

  parts.push('## 下次训练建议');
  parts.push('每个部分 2-4 句，建议部分给 3 条可执行建议。');
  parts.push('');
  parts.push(`活动名称: ${activity.name}`);
  parts.push(`开始时间: ${activity.startDateLocal}`);
  parts.push(`距离: ${formatDistance(activity.distanceM)}`);
  parts.push(`移动时长: ${formatDuration(activity.movingTimeS)}`);
  parts.push(`配速: ${formatPace(activity.paceSecPerKm)}`);
  parts.push(`海拔爬升: ${Math.round(activity.totalElevationGainM)}m`);
  parts.push(`平均心率: ${activity.averageHeartrate == null ? '--' : Math.round(activity.averageHeartrate)} bpm`);
  parts.push(`最高心率: ${activity.maxHeartrate == null ? '--' : Math.round(activity.maxHeartrate)} bpm`);
  parts.push('');
  parts.push('分段摘要:');
  parts.push(splitsSummary);

  if (plan) {
    parts.push('');
    parts.push('【训练计划】');
    parts.push(plan.planText);
    parts.push('');
    parts.push('请在"## 计划完成度"部分评估：');
    parts.push('- 计划目标 vs 实际完成');
    parts.push('- 完成率（距离、配速等）');
    parts.push('- 调整建议');
  }

  return parts.join('\n');
}

export async function analyzeActivityWithCodex(
  activity: RunActivity,
  plan?: TrainingPlan,
  options: AnalyzeOptions = {},
): Promise<string> {
  const workdir = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 240_000;

  const tempDir = await mkdtemp(join(tmpdir(), 'run-strava-codex-'));
  const outputPath = join(tempDir, 'analysis.md');
  const prompt = buildPrompt(activity, plan);

  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        'codex',
        ['exec', '--skip-git-repo-check', '-C', workdir, '--output-last-message', outputPath, prompt],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `codex exec failed with exit code ${result.code}`);
    }

    const text = (await readFile(outputPath, 'utf-8')).trim();
    if (!text) {
      throw new Error('Codex returned empty analysis content.');
    }

    return text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('`codex` command not found. Please install Codex CLI first.');
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
