'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Lead } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import {
  Download, Search, Mail, Phone, Globe, Star,
  Users, MapPin, Sparkles, ChevronUp, ChevronDown, Filter, Trash2, Target, Briefcase,
} from 'lucide-react';

type SortField = 'name' | 'rating' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [searchService, setSearchService] = useState('');
  const [sortField] = useState<SortField>('created_at');
  const [sortDir] = useState<SortDir>('desc');
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const params: Record<string, string> = {
    page: String(page),
    page_size: '100',
  };
  if (search) params.search = search;
  if (hasEmail) params.has_email = 'true';
  if (hasPhone) params.has_phone = 'true';
  if (hasWebsite) params.has_website = 'true';
  if (campaignName) params.campaign_name = campaignName;
  if (searchService) params.search_service = searchService;

  const { data, isLoading } = useQuery({
    queryKey: ['leads', params],
    queryFn: () => api.leads.list(params),
    refetchInterval: 10000,
  });

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', { page: '1', page_size: '100' }],
    queryFn: () => api.campaigns.list({ page: '1', page_size: '100' }),
  });
  const campaigns = campaignsData?.data ?? [];

  const leads = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 100);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['leads'] });

  const toggleSelect = (id: string) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedLeads.size === leads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.map(l => l.id)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this lead?')) return;
    try {
      await api.leads.delete(id);
      setSelectedLeads(prev => { const n = new Set(prev); n.delete(id); return n; });
      invalidate();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteBulk = async () => {
    const ids = Array.from(selectedLeads);
    if (!confirm(`Delete ${ids.length} selected lead${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.leads.deleteBulk(ids);
      setSelectedLeads(new Set());
      invalidate();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const resetFilters = () => {
    setSearch(''); setHasEmail(false); setHasPhone(false); setHasWebsite(false);
    setCampaignName(''); setSearchService(''); setPage(1);
  };

  const hasFilters = search || hasEmail || hasPhone || hasWebsite || campaignName || searchService;

  return (
    <div className="p-8 max-w-[1400px] mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">All Leads</h1>
          <p className="text-sm text-text-secondary mt-1">
            {total.toLocaleString()} leads across all campaigns
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedLeads.size > 0 && (
            <Button
              variant="danger"
              onClick={handleDeleteBulk}
              loading={deleting}
              icon={<Trash2 className="w-4 h-4" />}
            >
              Delete {selectedLeads.size} selected
            </Button>
          )}
          <a href={api.leads.exportUrl()} download>
            <Button variant="secondary" icon={<Download className="w-4 h-4" />}>
              Export All CSV
            </Button>
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 mb-6 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Text search */}
          <div className="flex-1 relative min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search by name, email, phone, address…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-bg-base border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
            />
          </div>

          {/* Has X filters */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-text-muted" />
            {[
              { state: hasEmail, setter: setHasEmail, label: 'Email', icon: Mail },
              { state: hasPhone, setter: setHasPhone, label: 'Phone', icon: Phone },
              { state: hasWebsite, setter: setHasWebsite, label: 'Website', icon: Globe },
            ].map(({ state, setter, label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => { setter(!state); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  state
                    ? 'bg-accent-muted text-accent-hover border-border-active'
                    : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>

          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
              Reset filters
            </button>
          )}
        </div>

        {/* Campaign + Service filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <select
              value={campaignName}
              onChange={e => { setCampaignName(e.target.value); setPage(1); }}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-bg-base border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active appearance-none"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              placeholder="Filter by service…"
              value={searchService}
              onChange={e => { setSearchService(e.target.value); setPage(1); }}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-bg-base border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="space-y-0">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="skeleton h-14 border-b border-border last:border-0" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="py-20 flex flex-col items-center text-center">
            <Users className="w-12 h-12 text-text-muted mb-4" />
            <p className="text-text-secondary font-medium">No leads found</p>
            <p className="text-xs text-text-muted mt-1">Try adjusting your filters or create a new campaign</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-surface/50">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedLeads.size === leads.length && leads.length > 0}
                      onChange={toggleAll}
                      className="rounded border-border bg-bg-base accent-accent"
                    />
                  </th>
                  {[
                    { label: 'Business', field: 'name' },
                    { label: 'Contact' },
                    { label: 'Rating', field: 'rating' },
                    { label: 'Enriched' },
                    { label: 'Campaign' },
                    { label: 'Service' },
                    { label: 'Added', field: 'created_at' },
                    { label: '' },
                  ].map(({ label, field }, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {label}
                        {field && (
                          <div className="flex flex-col">
                            <ChevronUp className="w-2.5 h-2.5 text-text-muted/50" />
                            <ChevronDown className="w-2.5 h-2.5 text-text-muted/50" />
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {leads.map((lead, i) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    selected={selectedLeads.has(lead.id)}
                    onSelect={() => toggleSelect(lead.id)}
                    onDelete={() => handleDelete(lead.id)}
                    alt={i % 2 !== 0}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 100 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-text-muted">
            Showing {((page - 1) * 100) + 1}–{Math.min(page * 100, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <span className="text-text-muted text-xs px-2">
              {page} / {totalPages}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadRow({
  lead, selected, onSelect, onDelete, alt,
}: {
  lead: Lead;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  alt: boolean;
}) {
  return (
    <tr className={`group table-row-hover transition-colors ${alt ? 'bg-bg-base/20' : ''} ${selected ? 'bg-accent-muted/30' : ''}`}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="rounded border-border bg-bg-base accent-accent"
        />
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-text-primary max-w-[180px] truncate">{lead.name || '—'}</div>
        {lead.address && (
          <div className="text-xs text-text-muted flex items-center gap-1 mt-0.5 max-w-[180px] truncate">
            <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
            {lead.address}
          </div>
        )}
        {lead.category && (
          <div className="text-xs text-text-muted mt-0.5">{lead.category}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-xs text-success hover:text-success/80 transition-colors">
              <Mail className="w-3 h-3" />
              <span className="truncate max-w-[140px]">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors">
              <Phone className="w-3 h-3" />
              {lead.phone}
            </a>
          )}
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors truncate max-w-[140px]">
              <Globe className="w-3 h-3 flex-shrink-0" />
              {lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {!lead.email && !lead.phone && !lead.website && (
            <span className="text-xs text-text-muted">No contact info</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {lead.rating ? (
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-warning text-warning" />
            <span className="text-sm font-medium text-text-primary">{lead.rating}</span>
            {lead.review_count && (
              <span className="text-xs text-text-muted">({lead.review_count})</span>
            )}
          </div>
        ) : <span className="text-text-muted text-xs">—</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium ${
          lead.enrich_status === 'done'    ? 'bg-success/10 text-success' :
          lead.enrich_status === 'pending' ? 'bg-accent-muted text-accent-hover' :
          lead.enrich_status === 'failed'  ? 'bg-danger/10 text-danger' :
          'bg-bg-hover text-text-muted'
        }`}>
          {lead.enrich_status === 'done' && <Sparkles className="w-2.5 h-2.5" />}
          {lead.enrich_status}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-text-muted max-w-[140px]">
        <div className="truncate font-medium text-text-secondary">{lead.campaign_name || '—'}</div>
      </td>
      <td className="px-4 py-3 text-xs text-text-muted">
        <div className="truncate max-w-[120px]">{lead.search_service || '—'}</div>
        <div className="truncate max-w-[120px] text-text-muted/60 mt-0.5">{lead.search_location}</div>
      </td>
      <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{formatDate(lead.created_at)}</td>
      <td className="px-4 py-3 w-10">
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-danger/10 text-text-muted hover:text-danger"
          title="Delete lead"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}
