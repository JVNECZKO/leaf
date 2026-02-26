'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { useEffect, useState } from 'react';
import { StatusBadge, Tag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatDate, formatNumber, progressPercent } from '@/lib/utils';
import {
  ArrowLeft, Play, Pause, Trash2, Download, Users,
  CheckCircle2, XCircle, Clock, MapPin, Globe, Mail, Phone,
  Star, Sparkles, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [leadsPage, setLeadsPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'leads' | 'tasks'>('leads');
  const [filters, setFilters] = useState({ has_email: '', has_phone: '', has_website: '', search: '' });
  const [tasksPage, setTasksPage] = useState(1);
  const [tasksPageSize, setTasksPageSize] = useState(10);
  const [tasksStatus, setTasksStatus] = useState('failed');

  const { data: campaign, isLoading: campaignLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.campaigns.get(id),
    refetchInterval: 4000,
  });

  const tasksParams: Record<string, string> = {
    page: String(tasksPage),
    page_size: String(tasksPageSize),
  };
  if (tasksStatus) tasksParams.status = tasksStatus;

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['campaign-tasks', id, tasksParams],
    queryFn: () => api.campaigns.tasks(id, tasksParams),
    enabled: activeTab === 'tasks',
    refetchInterval: 4000,
  });

  const leadsParams: Record<string, string> = {
    page: String(leadsPage),
    page_size: '50',
  };
  if (filters.has_email) leadsParams.has_email = 'true';
  if (filters.has_phone) leadsParams.has_phone = 'true';
  if (filters.has_website) leadsParams.has_website = 'true';
  if (filters.search) leadsParams.search = filters.search;

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['campaign-leads', id, leadsParams],
    queryFn: () => api.campaigns.leads(id, leadsParams),
    enabled: activeTab === 'leads',
    refetchInterval: 6000,
  });

  useEffect(() => {
    const unsub = wsClient.subscribe((msg) => {
      if (msg.campaign_id === id) {
        qc.invalidateQueries({ queryKey: ['campaign', id] });
        qc.invalidateQueries({ queryKey: ['campaign-leads', id] });
        qc.invalidateQueries({ queryKey: ['campaign-tasks', id] });
      }
    });
    return unsub;
  }, [id, qc]);

  const startMutation = useMutation({
    mutationFn: () => api.campaigns.start(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Campaign started'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.campaigns.stop(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Campaign paused'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.campaigns.delete(id),
    onSuccess: () => { toast.success('Campaign deleted'); router.push('/campaigns'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (campaignLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-accent animate-spin" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-8 text-center">
        <p className="text-text-secondary">Campaign not found</p>
        <Link href="/campaigns" className="text-accent text-sm mt-2 inline-block">← Back</Link>
      </div>
    );
  }

  const pct = progressPercent(campaign.completed_tasks, campaign.total_tasks);
  const isRunning = campaign.status === 'running';

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Back */}
      <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-text-primary">{campaign.name}</h1>
            <StatusBadge status={campaign.status} pulse />
          </div>
          <p className="text-sm text-text-muted">Created {formatDate(campaign.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={api.campaigns.exportUrl(id)} download>
            <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />}>
              Export CSV
            </Button>
          </a>

          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={() => stopMutation.mutate()} loading={stopMutation.isPending} icon={<Pause className="w-3.5 h-3.5" />}>
              Pause
            </Button>
          ) : campaign.status !== 'completed' ? (
            <Button size="sm" onClick={() => startMutation.mutate()} loading={startMutation.isPending} icon={<Play className="w-3.5 h-3.5" />}>
              {campaign.status === 'paused' ? 'Resume' : 'Start'}
            </Button>
          ) : null}

          <Button
            variant="danger"
            size="sm"
            onClick={() => { if (confirm('Delete this campaign?')) deleteMutation.mutate(); }}
            icon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Stats + Progress */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: formatNumber(campaign.total_leads), icon: Users, color: 'text-accent' },
          { label: 'Tasks Done', value: `${campaign.completed_tasks}/${campaign.total_tasks}`, icon: CheckCircle2, color: 'text-success' },
          { label: 'Failed', value: campaign.failed_tasks, icon: XCircle, color: 'text-danger' },
          { label: 'Parallel', value: campaign.concurrency, icon: Clock, color: 'text-warning' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-text-muted">{label}</span>
            </div>
            <div className="text-xl font-bold text-text-primary">{value}</div>
          </div>
        ))}
      </div>

      <div className="glass-card p-4 mb-6">
        <div className="flex justify-between text-xs text-text-muted mb-2">
          <span>Progress</span>
          <span>{pct}% complete</span>
        </div>
        <Progress value={pct} showLabel />
      </div>

      {/* Services + Locations */}
      {(campaign.services?.length || campaign.locations_count > 0) ? (
        <div className="glass-card p-4 mb-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">
              Services <span className="text-accent ml-1">{campaign.services?.length ?? 0}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {campaign.services?.slice(0, 30).map((s) => <Tag key={s.id}>{s.name}</Tag>)}
              {(campaign.services?.length ?? 0) > 30 && (
                <span className="text-xs text-text-muted px-2 py-0.5 bg-bg-hover rounded-full">
                  +{(campaign.services?.length ?? 0) - 30} more
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">
              Locations <span className="text-accent ml-1">{campaign.locations_count.toLocaleString()}</span>
            </p>
            <p className="text-xs text-text-secondary">
              {campaign.locations_count.toLocaleString()} locations configured
            </p>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['leads', 'tasks'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-all capitalize ${
              activeTab === tab
                ? 'text-accent border-b-2 border-accent -mb-px'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab}
            {tab === 'leads' && leadsData && (
              <span className="ml-2 text-xs px-1.5 py-0.5 bg-accent-muted text-accent-hover rounded-full">
                {leadsData.total}
              </span>
            )}
            {tab === 'tasks' && campaign.failed_tasks > 0 && (
              <span className="ml-2 text-xs px-1.5 py-0.5 bg-danger/10 text-danger rounded-full">
                {campaign.failed_tasks} failed
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Leads Tab */}
      {activeTab === 'leads' && (
        <div>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Search leads..."
              value={filters.search}
              onChange={(e) => { setFilters(f => ({ ...f, search: e.target.value })); setLeadsPage(1); }}
              className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
            />
            {[
              { key: 'has_email', label: 'Has Email', icon: Mail },
              { key: 'has_phone', label: 'Has Phone', icon: Phone },
              { key: 'has_website', label: 'Has Website', icon: Globe },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setFilters(f => ({ ...f, [key]: f[key as keyof typeof filters] ? '' : 'true' })); setLeadsPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                  filters[key as keyof typeof filters]
                    ? 'bg-accent-muted text-accent-hover border-border-active'
                    : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>

          <LeadsTable leads={leadsData?.data ?? []} loading={leadsLoading} />

          {/* Pagination */}
          {leadsData && leadsData.total > 50 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-text-muted">
                {((leadsPage - 1) * 50) + 1}–{Math.min(leadsPage * 50, leadsData.total)} of {leadsData.total}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setLeadsPage(p => Math.max(1, p - 1))} disabled={leadsPage === 1}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setLeadsPage(p => p + 1)} disabled={leadsPage * 50 >= leadsData.total}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          {/* Progress summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Completed', value: campaign.completed_tasks.toLocaleString(), color: 'text-success', status: 'completed' },
              { label: 'Failed', value: campaign.failed_tasks.toLocaleString(), color: 'text-danger', status: 'failed' },
              { label: 'Remaining', value: Math.max(0, campaign.total_tasks - campaign.completed_tasks - campaign.failed_tasks).toLocaleString(), color: 'text-text-secondary', status: 'pending' },
            ].map(({ label, value, color, status }) => (
              <button
                key={label}
                onClick={() => { setTasksStatus(status); setTasksPage(1); }}
                className={`glass-card p-4 text-center transition-all hover:border-border-hover ${tasksStatus === status ? 'border-border-active bg-accent-muted/20' : ''}`}
              >
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-text-muted mt-1">{label}</div>
              </button>
            ))}
          </div>

          {/* Toolbar: status filter + page size */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {(['', 'failed', 'completed', 'pending', 'running'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setTasksStatus(s); setTasksPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    tasksStatus === s
                      ? 'bg-accent text-white border-transparent'
                      : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                  }`}
                >
                  {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Per page:</span>
              {[10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => { setTasksPageSize(n); setTasksPage(1); }}
                  className={`px-2.5 py-1 rounded-md border transition-all ${
                    tasksPageSize === n
                      ? 'bg-accent text-white border-transparent'
                      : 'border-border text-text-muted hover:border-border-hover'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Tasks list */}
          {tasksLoading ? (
            <div className="glass-card divide-y divide-border">
              {[...Array(tasksPageSize > 10 ? 10 : tasksPageSize)].map((_, i) => (
                <div key={i} className="skeleton h-12 border-b border-border last:border-0" />
              ))}
            </div>
          ) : (tasksData?.data?.length ?? 0) === 0 ? (
            <div className="glass-card py-12 text-center">
              <CheckCircle2 className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-40" />
              <p className="text-text-secondary text-sm">No {tasksStatus || ''} tasks</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-hover">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Service</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Location</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Leads</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksData?.data?.map((task, i) => (
                    <tr key={task.id} className={`border-b border-border/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-bg-base/30'}`}>
                      <td className="px-4 py-2.5"><StatusBadge status={task.status} /></td>
                      <td className="px-4 py-2.5 font-medium text-text-primary">{task.service}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{task.location}</td>
                      <td className="px-4 py-2.5 text-text-muted">{task.lead_count}</td>
                      <td className="px-4 py-2.5">
                        {task.error_msg ? (
                          <span className="text-xs text-danger truncate max-w-xs block" title={task.error_msg}>
                            {task.error_msg}
                          </span>
                        ) : <span className="text-text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {tasksData && tasksData.total > tasksPageSize && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">
                {((tasksPage - 1) * tasksPageSize) + 1}–{Math.min(tasksPage * tasksPageSize, tasksData.total)} of {tasksData.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" onClick={() => setTasksPage(1)} disabled={tasksPage === 1}>«</Button>
                <Button variant="secondary" size="sm" onClick={() => setTasksPage(p => Math.max(1, p - 1))} disabled={tasksPage === 1}>‹ Prev</Button>
                <span className="px-3 py-1 text-xs text-text-muted">
                  Page {tasksPage} / {Math.ceil(tasksData.total / tasksPageSize)}
                </span>
                <Button variant="secondary" size="sm" onClick={() => setTasksPage(p => p + 1)} disabled={tasksPage * tasksPageSize >= tasksData.total}>Next ›</Button>
                <Button variant="secondary" size="sm" onClick={() => setTasksPage(Math.ceil(tasksData.total / tasksPageSize))} disabled={tasksPage * tasksPageSize >= tasksData.total}>»</Button>
              </div>
            </div>
          )}

          <div className="glass-card p-4 text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">Dynamic execution mode</p>
            <p className="text-text-muted text-xs">
              Tasks are generated on-the-fly from {(campaign.services?.length ?? 0).toLocaleString()} services ×{' '}
              {campaign.locations_count.toLocaleString()} locations ={' '}
              {campaign.total_tasks.toLocaleString()} pairs.
              Resume offset: {(campaign.task_offset ?? 0).toLocaleString()}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadsTable({ leads, loading }: { leads: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="glass-card overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-14 border-b border-border last:border-0" />
        ))}
      </div>
    );
  }

  if (!leads || leads.length === 0) {
    return (
      <div className="glass-card py-12 flex flex-col items-center text-center">
        <Users className="w-10 h-10 text-text-muted mb-3" />
        <p className="text-text-secondary font-medium">No leads yet</p>
        <p className="text-xs text-text-muted mt-1">Start the campaign to begin scraping</p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Name', 'Category', 'Phone', 'Email', 'Website', 'Rating', 'Enrich', 'Location'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead: any, i: number) => (
            <tr key={lead.id} className={`table-row-hover border-b border-border/50 last:border-0 ${i % 2 === 0 ? '' : 'bg-bg-base/30'}`}>
              <td className="px-4 py-3">
                <div className="font-medium text-text-primary truncate max-w-[180px]">{lead.name || '—'}</div>
                {lead.address && <div className="text-xs text-text-muted truncate max-w-[180px] flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5" />{lead.address}</div>}
              </td>
              <td className="px-4 py-3 text-text-secondary text-xs">{lead.category || '—'}</td>
              <td className="px-4 py-3">
                {lead.phone ? (
                  <a href={`tel:${lead.phone}`} className="text-text-secondary hover:text-accent transition-colors flex items-center gap-1 text-xs">
                    <Phone className="w-3 h-3" />{lead.phone}
                  </a>
                ) : <span className="text-text-muted text-xs">—</span>}
              </td>
              <td className="px-4 py-3">
                {lead.email ? (
                  <a href={`mailto:${lead.email}`} className="text-success hover:text-success/80 transition-colors flex items-center gap-1 text-xs">
                    <Mail className="w-3 h-3" />{lead.email}
                  </a>
                ) : <span className="text-text-muted text-xs">—</span>}
              </td>
              <td className="px-4 py-3">
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover transition-colors flex items-center gap-1 text-xs truncate max-w-[120px]">
                    <Globe className="w-3 h-3 flex-shrink-0" />{lead.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : <span className="text-text-muted text-xs">—</span>}
              </td>
              <td className="px-4 py-3">
                {lead.rating ? (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <Star className="w-3 h-3 fill-warning" />{lead.rating}
                    {lead.review_count && <span className="text-text-muted">({lead.review_count})</span>}
                  </span>
                ) : <span className="text-text-muted text-xs">—</span>}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md ${
                  lead.enrich_status === 'done' ? 'bg-success/10 text-success' :
                  lead.enrich_status === 'pending' ? 'bg-accent-muted text-accent-hover' :
                  lead.enrich_status === 'failed' ? 'bg-danger/10 text-danger' :
                  'bg-bg-hover text-text-muted'
                }`}>
                  {lead.enrich_status === 'done' && <Sparkles className="w-2.5 h-2.5" />}
                  {lead.enrich_status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-text-muted">{lead.search_location || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
