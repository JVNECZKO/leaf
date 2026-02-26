import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  className?: string;
  showLabel?: boolean;
  color?: 'accent' | 'success' | 'warning' | 'danger';
}

export function Progress({ value, className, showLabel, color = 'accent' }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));

  const colorClasses = {
    accent:  'from-accent to-[#8B5CF6]',
    success: 'from-success to-[#059669]',
    warning: 'from-warning to-[#D97706]',
    danger:  'from-danger to-[#DC2626]',
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
        <div
          className={cn('h-full bg-gradient-to-r rounded-full transition-all duration-500', colorClasses[color])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-text-muted w-8 text-right">{clamped}%</span>
      )}
    </div>
  );
}
