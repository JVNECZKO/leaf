'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { useEffect } from 'react';
import { formatNumber } from '@/lib/utils';
import {
  Users,
  Mail,
  Phone,
  Sparkles,
  Target,
  TrendingUp,
  Activity,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { progressPercent, formatDate } from '@/lib/utils';

export default function DashboardPage() {
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.stats,
    refetchInterval: 5000,
  });

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: api.campaigns.list,
    refetchInterval: 5000,
  });

  // Real-time updates
  useEffect(() => {
    const unsub = wsClient.subscribe(() => {
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    });
    return unsub;
  }, [qc]);

  const statCards = [
    {
      label: 'Total Leads',
      value: stats?.total_leads ?? 0,
      icon: Users,
      color: 'text-accent',
      bg: 'bg-accent-muted',
    },
    {
      label: 'With Email',
      value: stats?.total_with_email ?? 0,
      icon: Mail,
      color: 'text-success',
      bg: 'bg-success/10',
    },
    {
      label: 'With Phone',
      value: stats?.total_with_phone ?? 0,
      icon: Phone,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      label: 'Enriched',
      value: stats?.total_enriched ?? 0,
      icon: Sparkles,
      color: 'text-[#A78BFA]',
      bg: 'bg-[#A78BFA]/10',
    },
  ];

  const recentCampaigns = (campaigns ?? []).slice(0, 5);

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-accent" />
          <span className="text-xs text-text-muted uppercase tracking-widest font-medium">Overview</span>
        </div>
        <h1 className="text-3xl font-bold text-text-primary">
          Welcome to{' '}
          <span className="gradient-text">Leaf</span>
        </h1>
        <p className="mt-2 text-text-secondary">
          {stats?.running_campaigns
            ? `${stats.running_campaigns} campaign${stats.running_campaigns > 1 ? 's' : ''} running right now`
            : 'Your Google Maps lead generation command center'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="glass-card p-5 group hover:border-border-hover transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <TrendingUp className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-text-primary tabular-nums">
              {formatNumber(value)}
            </div>
            <div className="text-xs text-text-muted mt-1 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent campaigns */}
        <div className="lg:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Recent Campaigns</h2>
              <p className="text-xs text-text-muted mt-0.5">{campaigns?.length ?? 0} total</p>
            </div>
            <Link
              href="/campaigns"
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium transition-colors"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {recentCampaigns.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="w-12 h-12 rounded-xl bg-accent-muted flex items-center justify-center mb-3">
                <Target className="w-5 h-5 text-accent" />
              </div>
              <p className="text-sm text-text-secondary font-medium">No campaigns yet</p>
              <p className="text-xs text-text-muted mt-1">Create your first campaign to start scraping</p>
              <Link
                href="/campaigns"
                className="mt-4 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors font-medium"
              >
                Create Campaign
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentCampaigns.map((c) => {
                const pct = progressPercent(c.completed_tasks, c.total_tasks);
                return (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}`}
                    className="flex items-center gap-4 p-4 rounded-xl hover:bg-bg-hover transition-all duration-150 group border border-transparent hover:border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-medium text-text-primary truncate">{c.name}</span>
                        <StatusBadge status={c.status} pulse />
                      </div>
                      <Progress value={pct} />
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-text-primary tabular-nums">
                        {formatNumber(c.total_leads)}
                      </div>
                      <div className="text-xs text-text-muted">leads</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick stats panel */}
        <div className="glass-card p-6">
          <h2 className="text-base font-semibold text-text-primary mb-6">Platform Status</h2>

          <div className="space-y-5">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-text-muted">Email Coverage</span>
                <span className="text-text-secondary font-medium">
                  {stats?.total_leads
                    ? Math.round((stats.total_with_email / stats.total_leads) * 100)
                    : 0}%
                </span>
              </div>
              <Progress
                value={stats?.total_leads ? (stats.total_with_email / stats.total_leads) * 100 : 0}
                color="success"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-text-muted">Phone Coverage</span>
                <span className="text-text-secondary font-medium">
                  {stats?.total_leads
                    ? Math.round((stats.total_with_phone / stats.total_leads) * 100)
                    : 0}%
                </span>
              </div>
              <Progress
                value={stats?.total_leads ? (stats.total_with_phone / stats.total_leads) * 100 : 0}
                color="warning"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-text-muted">Enrichment Rate</span>
                <span className="text-text-secondary font-medium">
                  {stats?.total_leads
                    ? Math.round((stats.total_enriched / stats.total_leads) * 100)
                    : 0}%
                </span>
              </div>
              <Progress
                value={stats?.total_leads ? (stats.total_enriched / stats.total_leads) * 100 : 0}
                color="accent"
              />
            </div>

            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Total Campaigns</span>
                <span className="font-semibold text-text-primary">{stats?.total_campaigns ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Running Now</span>
                <span className="font-semibold text-accent">{stats?.running_campaigns ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Total Leads</span>
                <span className="font-semibold text-text-primary">{formatNumber(stats?.total_leads ?? 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
