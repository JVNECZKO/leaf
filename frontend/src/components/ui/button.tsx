import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';

  const variants = {
    primary:
      'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-glow-sm',
    secondary:
      'bg-bg-hover text-text-secondary border border-border hover:border-border-hover hover:text-text-primary',
    ghost:
      'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
    danger:
      'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20',
    success:
      'bg-success/10 text-success border border-success/20 hover:bg-success/20',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  };

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
}
