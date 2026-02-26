import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function progressPercent(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

export const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  pending:   { bg: 'bg-text-muted/10',    text: 'text-text-secondary', dot: 'bg-text-secondary' },
  running:   { bg: 'bg-accent-muted',     text: 'text-accent-hover',   dot: 'bg-accent' },
  paused:    { bg: 'bg-warning/10',        text: 'text-warning',        dot: 'bg-warning' },
  completed: { bg: 'bg-success/10',        text: 'text-success',        dot: 'bg-success' },
  failed:    { bg: 'bg-danger/10',         text: 'text-danger',         dot: 'bg-danger' },
  done:      { bg: 'bg-success/10',        text: 'text-success',        dot: 'bg-success' },
  none:      { bg: 'bg-text-muted/10',    text: 'text-text-muted',     dot: 'bg-text-muted' },
};
