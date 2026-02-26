import { cn } from '@/lib/utils';
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full px-3 py-2 rounded-lg text-sm bg-bg-base border transition-all duration-150',
            'text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active',
            error ? 'border-danger/50' : 'border-border hover:border-border-hover',
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-text-secondary">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className={cn(
            'w-full px-3 py-2 rounded-lg text-sm bg-bg-base border transition-all duration-150',
            'text-text-primary placeholder:text-text-muted resize-none',
            'focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active',
            error ? 'border-danger/50' : 'border-border hover:border-border-hover',
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';
