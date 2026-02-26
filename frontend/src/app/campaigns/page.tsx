'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Campaign } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { CreateCampaignModal } from '@/components/campaigns/create-campaign-modal';
import { EditCampaignModal } from '@/components/campaigns/edit-campaign-modal';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatDate, formatNumber, progressPercent } from '@/lib/utils';
import {
  Plus, Play, Pause, Trash2, Target, ArrowRight, Users,
  CheckCircle2, XCircle, Clock, PauseCircle, Pencil, Layers,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

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

  const stopAllMutation = useMutation({
    mutationFn: api.campaigns.stopAll,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`Paused ${res.stopped} campaign${res.stopped !== 1 ? 's' : ''}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runningCount = campaigns?.filter(c => c.status === 'running').length ?? 0;

  // Group campaigns: batched ones grouped by batch_id, standalone ones listed normally
  const { batches, standalone } = useMemo(() => {
    if (!campaigns) return { batches: new Map<string, Campaign[]>(), standalone: [] };
    const batchMap = new Map<string, Campaign[]>();
    const solo: Campaign[] = [];
    for (const c of campaigns) {
      if (c.batch_id) {
        const arr = batchMap.get(c.batch_id) ?? [];
        arr.push(c);
        batchMap.set(c.batch_id, arr);
      } else {
        solo.push(c);
      }
    }
    return { batches: batchMap, standalone: solo };
  }, [campaigns]);

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Campaigns</h1>
          <p className="text-sm text-text-secondary mt-1">
            {campaigns?.length ?? 0} campaigns total{runningCount > 0 && ` · ${runningCount} running`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <Button
              variant="secondary"
              onClick={() => stopAllMutation.mutate()}
              loading={stopAllMutation.isPending}
              icon={<PauseCircle className="w-4 h-4" />}
            >
              Pause All
            </Button>
          )}
          <Button onClick={() => setModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
            New Campaign
          </Button>
        </div>
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
        <div className="space-y-6">
          {/* Batch groups */}
          {Array.from(batches.entries()).map(([batchId, bCampaigns]) => {
            const sorted = [...bCampaigns].sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));
            const totalLeads = sorted.reduce((s, c) => s + c.total_leads, 0);
            const totalCompleted = sorted.reduce((s, c) => s + c.completed_tasks, 0);
            const totalTasks = sorted.reduce((s, c) => s + c.total_tasks, 0);
            const batchRunning = sorted.filter(c => c.status === 'running').length;
            const batchDone = sorted.filter(c => c.status === 'completed').length;
            const prefix = sorted[0]?.name.split(' — ').slice(1).join(' — ') || 'Batch';

            return (
              <div key={batchId} className="space-y-2">
                {/* Batch header */}
                <div className="flex items-center gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#A78BFA]" />
                    <span className="text-sm font-semibold text-text-primary">
                      {prefix}
                    </span>
                    <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-bg-hover border border-border">
                      {sorted.length} campaigns
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-border" />
                  <div className="text-xs text-text-muted flex items-center gap-3">
                    <span>{formatNumber(totalLeads)} leads</span>
                    <span>{totalCompleted}/{totalTasks} tasks</span>
                    {batchRunning > 0 && (
                      <button
                        onClick={() => {
                          sorted.filter(c => c.status === 'running').forEach(c => stopMutation.mutate(c.id));
                        }}
                        className="flex items-center gap-1 text-warning hover:text-warning/80 transition-colors"
                      >
                        <PauseCircle className="w-3.5 h-3.5" />
                        Pause batch
                      </button>
                    )}
                    {batchRunning === 0 && batchDone < sorted.length && (
                      <button
                        onClick={() => {
                          sorted.filter(c => c.status === 'pending' || c.status === 'paused')
                            .forEach(c => startMutation.mutate(c.id));
                        }}
                        className="flex items-center gap-1 text-accent hover:text-accent-hover transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Start batch
                      </button>
                    )}
                  </div>
                </div>

                {/* Batch campaigns */}
                <div className="space-y-2 pl-2 border-l-2 border-[#A78BFA]/30">
                  {sorted.map(campaign => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      onStart={() => startMutation.mutate(campaign.id)}
                      onStop={() => stopMutation.mutate(campaign.id)}
                      onDelete={() => {
                        if (confirm(`Delete "${campaign.name}"? This cannot be undone.`))
                          deleteMutation.mutate(campaign.id);
                      }}
                      onEdit={() => setEditCampaign(campaign)}
                      startLoading={startMutation.isPending}
                      stopLoading={stopMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Standalone campaigns */}
          {standalone.length > 0 && (
            <div className="space-y-3">
              {batches.size > 0 && (
                <div className="flex items-center gap-3 px-1">
                  <span className="text-sm font-medium text-text-muted">Individual campaigns</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              {standalone.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onStart={() => startMutation.mutate(campaign.id)}
                  onStop={() => stopMutation.mutate(campaign.id)}
                  onDelete={() => {
                    if (confirm(`Delete "${campaign.name}"? This cannot be undone.`))
                      deleteMutation.mutate(campaign.id);
                  }}
                  onEdit={() => setEditCampaign(campaign)}
                  startLoading={startMutation.isPending}
                  stopLoading={stopMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <CreateCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <EditCampaignModal campaign={editCampaign} onClose={() => setEditCampaign(null)} />
    </div>
  );
}

function CampaignCard({
  campaign, onStart, onStop, onDelete, onEdit, startLoading, stopLoading,
}: {
  campaign: Campaign;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onEdit: () => void;
  startLoading: boolean;
  stopLoading: boolean;
}) {
  const pct = progressPercent(campaign.completed_tasks, campaign.total_tasks);
  const isRunning = campaign.status === 'running';

  return (
    <div className="glass-card p-5 hover:border-border-hover transition-all duration-200">
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isRunning ? 'bg-accent-muted' : 'bg-bg-hover'
        }`}>
          <Target className={`w-5 h-5 ${isRunning ? 'text-accent' : 'text-text-muted'}`} />
        </div>

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

          <Progress value={pct} showLabel />
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={onStop} loading={stopLoading} icon={<Pause className="w-3.5 h-3.5" />}>
              Pause
            </Button>
          ) : campaign.status !== 'completed' ? (
            <Button variant="primary" size="sm" onClick={onStart} loading={startLoading} icon={<Play className="w-3.5 h-3.5" />}>
              Start
            </Button>
          ) : null}

          <Link href={`/campaigns/${campaign.id}`}>
            <Button variant="ghost" size="sm" icon={<ArrowRight className="w-3.5 h-3.5" />}>
              View
            </Button>
          </Link>

          <Button variant="ghost" size="sm" onClick={onEdit} title="Edit campaign">
            <Pencil className="w-3.5 h-3.5 text-text-muted hover:text-text-primary transition-colors" />
          </Button>

          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger transition-colors" />
          </Button>
        </div>
      </div>
    </div>
  );
}
