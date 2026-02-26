import { cn, statusColors } from '@/lib/utils';

interface BadgeProps {
  status: string;
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({ status, pulse, className }: BadgeProps) {
  const colors = statusColors[status] || statusColors['pending'];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
        colors.bg,
        colors.text,
        className
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          colors.dot,
          pulse && status === 'running' && 'animate-pulse'
        )}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

interface TagProps {
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}

export function Tag({ children, variant = 'default', className }: TagProps) {
  const variantClasses = {
    default: 'bg-bg-hover text-text-secondary border-border',
    accent:  'bg-accent-muted text-accent-hover border-border-active',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    danger:  'bg-danger/10 text-danger border-danger/20',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
