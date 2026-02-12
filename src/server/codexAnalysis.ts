import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PeriodAnalysisPeriod, RunActivity, SummaryMetrics, TrainingPlan } from '../shared/types.js';

interface AnalyzeOptions {
  cwd?: string;
  timeoutMs?: number;
}

interface CodexExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
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
            const hr = split.averageHeartrate == null ? '--' : `${Math.round(split.averageHeartrate)} bpm`;
            return `- 第${split.splitIndex}公里: ${Math.round(split.distanceM)}m, ${split.elapsedTimeS}s, 配速${pace}, 心率${hr}`;
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

function formatPeriodLabel(period: PeriodAnalysisPeriod): string {
  if (period === 'week') {
    return '周';
  }
  if (period === 'month') {
    return '月';
  }
  return '年';
}

interface PeriodAnalysisInput {
  period: PeriodAnalysisPeriod;
  from: string;
  to: string;
  summary: SummaryMetrics;
  recentRuns: RunActivity[];
}

function buildPeriodPrompt(input: PeriodAnalysisInput): string {
  const recentRunsSummary =
    input.recentRuns.length === 0
      ? '- 本周期无跑步记录'
      : input.recentRuns
          .slice(0, 12)
          .map((run) => {
            return `- ${run.startDateLocal} | ${run.name} | ${formatDistance(run.distanceM)} | ${formatDuration(run.movingTimeS)} | ${formatPace(run.paceSecPerKm)}`;
          })
          .join('\n');

  return [
    `你是专业跑步教练。请基于本${formatPeriodLabel(input.period)}训练数据给出中文分析。`,
    '输出格式必须是 Markdown，包含以下 4 个标题：',
    '## 周期总结',
    '## 训练亮点',
    '## 风险提示',
    '## 下阶段建议',
    '每个部分 2-4 句，建议部分给 3 条可执行建议。',
    '',
    `分析周期: ${input.from} 到 ${input.to}`,
    `跑步次数: ${input.summary.totalRuns}`,
    `总里程: ${formatDistance(input.summary.totalDistanceM)}`,
    `总移动时长: ${formatDuration(input.summary.totalMovingTimeS)}`,
    `平均配速: ${formatPace(input.summary.averagePaceSecPerKm)}`,
    `最快配速: ${formatPace(input.summary.bestPaceSecPerKm)}`,
    `总爬升: ${Math.round(input.summary.totalElevationGainM)}m`,
    `平均心率: ${input.summary.averageHeartrate == null ? '--' : Math.round(input.summary.averageHeartrate)} bpm`,
    '',
    '近期跑步样本:',
    recentRunsSummary,
  ].join('\n');
}

async function runCodexPrompt(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
  const workdir = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 240_000;

  const tempDir = await mkdtemp(join(tmpdir(), 'run-strava-codex-'));
  const outputPath = join(tempDir, 'analysis.md');

  try {
    const result = await new Promise<CodexExecResult>((resolve, reject) => {
      const child = spawn(
        'codex',
        ['exec', '--skip-git-repo-check', '-C', workdir, '--output-last-message', outputPath, prompt],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
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
        resolve({ code, stdout, stderr });
      });
    });

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `codex exec failed with exit code ${result.code}`);
    }

    const text = (await readFile(outputPath, 'utf-8')).trim();
    if (text) {
      return text;
    }

    // Fallback: parse JSON event stream when output file is empty.
    const fallback = await new Promise<CodexExecResult>((resolve, reject) => {
      const child = spawn('codex', ['exec', '--skip-git-repo-check', '-C', workdir, '--json', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
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
        resolve({ code, stdout, stderr });
      });
    });

    if (fallback.code !== 0) {
      throw new Error(fallback.stderr.trim() || `codex exec failed with exit code ${fallback.code}`);
    }

    let agentMessage = '';
    for (const line of fallback.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) {
        continue;
      }
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          item?: { type?: string; text?: string };
        };
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
          agentMessage = event.item.text;
        }
      } catch {
        // Ignore non-JSON log lines from codex CLI.
      }
    }

    if (agentMessage.trim()) {
      return agentMessage.trim();
    }

    const stderrPreview = `${result.stderr}\n${fallback.stderr}`.trim().slice(-1200);
    throw new Error(
      stderrPreview
        ? `Codex returned empty analysis content. stderr: ${stderrPreview}`
        : 'Codex returned empty analysis content.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('`codex` command not found. Please install Codex CLI first.');
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function analyzeActivityWithCodex(
  activity: RunActivity,
  plan?: TrainingPlan,
  options: AnalyzeOptions = {},
): Promise<string> {
  const prompt = buildPrompt(activity, plan);
  return runCodexPrompt(prompt, options);
}

export async function analyzePeriodWithCodex(input: PeriodAnalysisInput, options: AnalyzeOptions = {}): Promise<string> {
  const prompt = buildPeriodPrompt(input);
  return runCodexPrompt(prompt, options);
}
