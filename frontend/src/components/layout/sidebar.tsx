'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Target,
  Users,
  Settings,
  Leaf,
  Zap,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearToken } from '@/lib/auth';

const nav = [
  { href: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/campaigns',  label: 'Campaigns',  icon: Target },
  { href: '/leads',      label: 'Leads',      icon: Users },
  { href: '/settings',   label: 'Settings',   icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.replace('/login');
  }

  return (
    <aside className="w-[220px] flex-shrink-0 h-screen flex flex-col border-r border-border bg-bg-surface">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-accent flex items-center justify-center shadow-glow-sm">
          <Leaf className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-semibold text-text-primary tracking-tight">Leaf</span>
          <div className="flex items-center gap-1 mt-0.5">
            <Zap className="w-2.5 h-2.5 text-accent" />
            <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">Lead Engine</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-accent-muted text-accent-hover border border-border-active'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              <Icon className={cn('w-4 h-4', active ? 'text-accent' : 'text-text-muted')} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border space-y-2">
        <div className="glass-card p-3">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Scrape unlimited leads from Google Maps. No API keys required.
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
