'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { CreateCampaignModal } from '@/components/campaigns/create-campaign-modal';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatDate, formatNumber, progressPercent } from '@/lib/utils';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Target,
  ArrowRight,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: api.campaigns.list,
    refetchInterval: 4000,
  });

  useEffect(() => {
    const unsub = wsClient.subscribe(() => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    });
    return unsub;
  }, [qc]);

  const startMutation = useMutation({
    mutationFn: (id: string) => api.campaigns.start(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign started');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.campaigns.stop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.campaigns.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Campaign deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Campaigns</h1>
          <p className="text-sm text-text-secondary mt-1">
            {campaigns?.length ?? 0} campaigns total
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
          New Campaign
        </Button>
      </div>

      {/* Campaign list */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card p-6 skeleton h-28 rounded-xl" />
          ))}
        </div>
      ) : !campaigns?.length ? (
        <div className="glass-card py-20 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent-muted flex items-center justify-center mb-4">
            <Target className="w-7 h-7 text-accent" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary">No campaigns yet</h3>
          <p className="text-sm text-text-secondary mt-2 max-w-sm">
            Create your first campaign by adding services and locations to scrape from Google Maps.
          </p>
          <Button className="mt-6" onClick={() => setModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
            Create Campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const pct = progressPercent(campaign.completed_tasks, campaign.total_tasks);
            const isRunning = campaign.status === 'running';

            return (
              <div
                key={campaign.id}
                className="glass-card p-5 hover:border-border-hover transition-all duration-200"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isRunning ? 'bg-accent-muted' : 'bg-bg-hover'
                  }`}>
                    <Target className={`w-5 h-5 ${isRunning ? 'text-accent' : 'text-text-muted'}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/campaigns/${campaign.id}`}
                        className="text-base font-semibold text-text-primary hover:text-accent transition-colors truncate"
                      >
                        {campaign.name}
                      </Link>
                      <StatusBadge status={campaign.status} pulse />
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-text-muted mb-3">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {formatNumber(campaign.total_leads)} leads
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-success" />
                        {campaign.completed_tasks}/{campaign.total_tasks} tasks
                      </span>
                      {campaign.failed_tasks > 0 && (
                        <span className="flex items-center gap-1 text-danger">
                          <XCircle className="w-3 h-3" />
                          {campaign.failed_tasks} failed
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(campaign.created_at)}
                      </span>
                    </div>

                    {/* Progress */}
                    <Progress value={pct} showLabel />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRunning ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => stopMutation.mutate(campaign.id)}
                        loading={stopMutation.isPending}
                        icon={<Pause className="w-3.5 h-3.5" />}
                      >
                        Pause
                      </Button>
                    ) : campaign.status !== 'completed' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => startMutation.mutate(campaign.id)}
                        loading={startMutation.isPending}
                        icon={<Play className="w-3.5 h-3.5" />}
                      >
                        Start
                      </Button>
                    ) : null}

                    <Link href={`/campaigns/${campaign.id}`}>
                      <Button variant="ghost" size="sm" icon={<ArrowRight className="w-3.5 h-3.5" />}>
                        View
                      </Button>
                    </Link>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete "${campaign.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(campaign.id);
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger transition-colors" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
