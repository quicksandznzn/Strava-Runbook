import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunActivity } from '../shared/types.js';

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

function buildPrompt(activity: RunActivity): string {
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

  return [
    '你是专业跑步教练。请基于这次跑步数据给出中文分析。',
    '输出格式必须是 Markdown，包含以下 4 个标题：',
    '## 本次总结',
    '## 亮点',
    '## 风险提示',
    '## 下次训练建议',
    '每个部分 2-4 句，建议部分给 3 条可执行建议。',
    '',
    `活动名称: ${activity.name}`,
    `开始时间: ${activity.startDateLocal}`,
    `距离: ${formatDistance(activity.distanceM)}`,
    `移动时长: ${formatDuration(activity.movingTimeS)}`,
    `配速: ${formatPace(activity.paceSecPerKm)}`,
    `海拔爬升: ${Math.round(activity.totalElevationGainM)}m`,
    `平均心率: ${activity.averageHeartrate == null ? '--' : Math.round(activity.averageHeartrate)} bpm`,
    `最高心率: ${activity.maxHeartrate == null ? '--' : Math.round(activity.maxHeartrate)} bpm`,
    '',
    '分段摘要:',
    splitsSummary,
  ].join('\n');
}

export async function analyzeActivityWithCodex(activity: RunActivity, options: AnalyzeOptions = {}): Promise<string> {
  const workdir = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 240_000;

  const tempDir = await mkdtemp(join(tmpdir(), 'run-strava-codex-'));
  const outputPath = join(tempDir, 'analysis.md');
  const prompt = buildPrompt(activity);

  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        'codex',
        ['exec', '--skip-git-repo-check', '-C', workdir, '-o', outputPath, prompt],
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
