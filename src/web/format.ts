import { metersToKm } from '../shared/units.js';

const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export function formatDistance(meters: number): string {
  return `${numberFormatter.format(metersToKm(meters))} km`;
}

export function formatElevation(meters: number): string {
  return `${integerFormatter.format(meters)} m`;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

export function formatPace(paceSecPerKm: number | null): string {
  if (!paceSecPerKm || !Number.isFinite(paceSecPerKm)) {
    return '--';
  }

  const total = Math.round(paceSecPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

export function formatDateTime(value: string): string {
  const normalized = value.replace('T', ' ').replace('Z', '');
  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (matched) {
    const [, y, m, d, hh, mm] = matched;
    return `${y}/${m}/${d} ${hh}:${mm}`;
  }

  // Fallback for unexpected formats.
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return value;
}

export function formatHeartRate(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)} bpm`;
}

export function formatCadence(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)} spm`;
}

export function formatCalories(value: number | null): string {
  if (value == null) {
    return '--';
  }
  return `${Math.round(value)} kcal`;
}
