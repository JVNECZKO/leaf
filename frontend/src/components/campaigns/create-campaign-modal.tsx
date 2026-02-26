'use client';

import { useState, useMemo } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { api, type CreateCampaignPayload, type CreateBatchPayload } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus, Minus, Globe, Zap, Pencil, Map, List, Layers,
  Search, CheckSquare, Square, LayoutList,
} from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const REGIONS = [
  { value: 'usa',    label: 'USA',    flag: '🇺🇸' },
  { value: 'poland', label: 'Poland', flag: '🇵🇱' },
  { value: 'eu',     label: 'EU',     flag: '🇪🇺' },
  { value: 'custom', label: 'Custom', flag: '📐' },
] as const;

const PRECISIONS = [
  { value: 3, label: 'City',     desc: '~156 km' },
  { value: 4, label: 'District', desc: '~39 km'  },
  { value: 5, label: 'Street',   desc: '~5 km'   },
] as const;

export function CreateCampaignModal({ open, onClose }: Props) {
  const qc = useQueryClient();

  // Campaign mode
  const [campaignMode, setCampaignMode] = useState<'single' | 'split'>('single');

  // Services mode
  const [servicesMode, setServicesMode] = useState<'manual' | 'predefined'>('manual');
  const [servicesText, setServicesText] = useState('');
  const [predefinedSearch, setPredefinedSearch] = useState('');
  const [selectedPredefined, setSelectedPredefined] = useState<Set<string>>(new Set());

  // Common fields
  const [name, setName] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [enrichmentEnabled, setEnrichmentEnabled] = useState(true);

  // Split Mode queue
  const [queueConcurrency, setQueueConcurrency] = useState(0); // 0 = auto
  const [autoStart, setAutoStart] = useState(true);

  // Locations
  const [locationsText, setLocationsText] = useState('');
  const [locationMode, setLocationMode] = useState<'manual' | 'geohash'>('manual');
  const [geohashRegion, setGeohashRegion] = useState<string>('poland');
  const [geohashPrecision, setGeohashPrecision] = useState(4);
  const [customBbox, setCustomBbox] = useState('');

  const effectiveArea = geohashRegion === 'custom' ? customBbox : geohashRegion;

  const { data: tileData } = useQuery({
    queryKey: ['geohash-count', effectiveArea, geohashPrecision],
    queryFn: () => api.geohash.count(effectiveArea, geohashPrecision),
    enabled: locationMode === 'geohash' && effectiveArea.trim() !== '' && effectiveArea !== 'custom',
    staleTime: 60_000,
  });

  const { data: predefinedServices = [] } = useQuery({
    queryKey: ['predefined-services'],
    queryFn: api.predefinedServices.list,
    enabled: open,
  });

  const filteredPredefined = useMemo(() => {
    if (!predefinedSearch.trim()) return predefinedServices;
    const q = predefinedSearch.toLowerCase();
    return predefinedServices.filter(s => s.name.toLowerCase().includes(q));
  }, [predefinedServices, predefinedSearch]);

  const togglePredefined = (svcName: string) => {
    setSelectedPredefined(prev => {
      const next = new Set(prev);
      if (next.has(svcName)) next.delete(svcName); else next.add(svcName);
      return next;
    });
  };

  const toggleAllPredefined = () => {
    if (selectedPredefined.size === filteredPredefined.length) {
      setSelectedPredefined(new Set());
    } else {
      setSelectedPredefined(new Set(filteredPredefined.map(s => s.name)));
    }
  };

  const getServices = (): string[] => {
    if (servicesMode === 'predefined') return Array.from(selectedPredefined);
    return servicesText.split('\n').map(s => s.trim()).filter(Boolean);
  };

  const handleConcurrencyChange = (n: number) => {
    setConcurrency(n);
    setCustomMode(false);
    setCustomValue('');
  };

  const applyCustom = () => {
    const n = parseInt(customValue, 10);
    if (n >= 1) { setConcurrency(n); setCustomMode(false); }
  };

  const createSingleMutation = useMutation({
    mutationFn: (data: CreateCampaignPayload) => api.campaigns.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Campaign created');
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createBatchMutation = useMutation({
    mutationFn: (data: CreateBatchPayload) => api.campaigns.createBatch(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success(`Created ${res.count} campaigns`);
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setName(''); setNamePrefix(''); setServicesText('');
    setLocationsText(''); setConcurrency(2);
    setCustomMode(false); setCustomValue('');
    setEnrichmentEnabled(true);
    setLocationMode('manual'); setGeohashRegion('poland');
    setGeohashPrecision(4); setCustomBbox('');
    setCampaignMode('single'); setServicesMode('manual');
    setPredefinedSearch(''); setSelectedPredefined(new Set());
    setQueueConcurrency(0); setAutoStart(true);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const services = getServices();
    if (services.length === 0) return toast.error('Add at least one service');

    const locations = locationsText.split('\n').map(l => l.trim()).filter(Boolean);

    if (locationMode === 'geohash') {
      if (!effectiveArea || effectiveArea === 'custom') {
        return toast.error('Enter a custom bounding box');
      }
    } else {
      if (locations.length === 0) return toast.error('Add at least one location');
    }

    if (campaignMode === 'split') {
      createBatchMutation.mutate({
        services,
        locations: locationMode === 'manual' ? locations : undefined,
        location_mode: locationMode,
        geohash_area: locationMode === 'geohash' ? effectiveArea : undefined,
        geohash_precision: locationMode === 'geohash' ? geohashPrecision : undefined,
        concurrency,
        enrichment_enabled: enrichmentEnabled,
        name_prefix: namePrefix.trim(),
        queue_concurrency: queueConcurrency,
        auto_start: autoStart,
      });
    } else {
      if (!name.trim()) return toast.error('Campaign name is required');
      if (locationMode === 'geohash') {
        createSingleMutation.mutate({
          name: name.trim(), services, concurrency,
          enrichment_enabled: enrichmentEnabled,
          geohash_mode: true, geohash_area: effectiveArea,
          geohash_precision: geohashPrecision,
        });
      } else {
        createSingleMutation.mutate({
          name: name.trim(), services, locations, concurrency,
          enrichment_enabled: enrichmentEnabled,
        });
      }
    }
  };

  const serviceCount = getServices().length;
  const locationCount = locationsText.split('\n').filter(l => l.trim()).length;
  const tileCount = tileData?.count ?? 0;
  const totalTasks = locationMode === 'geohash'
    ? serviceCount * tileCount
    : serviceCount * locationCount;
  const isPending = createSingleMutation.isPending || createBatchMutation.isPending;

  return (
    <Modal open={open} onClose={handleClose} title="New Campaign" description="Configure your Google Maps scraping campaign" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Campaign Mode toggle */}
        <div className="p-4 rounded-xl border border-border bg-bg-base space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-secondary">Campaign Mode</label>
            <div className="flex items-center gap-1 p-0.5 bg-bg-hover rounded-lg border border-border">
              <button type="button" onClick={() => setCampaignMode('single')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  campaignMode === 'single' ? 'bg-bg-surface text-text-primary shadow-sm border border-border' : 'text-text-muted hover:text-text-secondary'}`}>
                <LayoutList className="w-3 h-3" /> Single
              </button>
              <button type="button" onClick={() => setCampaignMode('split')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  campaignMode === 'split' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <Layers className="w-3 h-3" /> Split
              </button>
            </div>
          </div>

          {campaignMode === 'single' ? (
            <Input label="" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Plumbers in Poland Q1 2025" />
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-accent-muted/30 border border-border-active text-xs text-text-secondary">
                Split Mode creates one campaign per service. Each runs independently.
              </div>
              <Input label="" value={namePrefix} onChange={e => setNamePrefix(e.target.value)}
                placeholder="Name suffix (optional): e.g. 'Q1 2025' → 'dentist — Q1 2025'" />
              {serviceCount > 0 && (
                <p className="text-xs text-text-muted">
                  Will create <span className="font-semibold text-text-primary">{serviceCount} campaigns</span>:{' '}
                  {getServices().slice(0, 3).map(s => namePrefix ? `${s} — ${namePrefix}` : s).join(', ')}
                  {serviceCount > 3 && ` +${serviceCount - 3} more`}
                </p>
              )}
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-text-secondary">Queue Concurrency</label>
                  <span className="text-xs text-text-muted">{queueConcurrency === 0 ? 'Auto' : `${queueConcurrency} at a time`}</span>
                </div>
                <div className="flex items-center gap-2">
                  {[{ v: 0, label: 'Auto' }, { v: 1, label: '1' }, { v: 2, label: '2' }, { v: 3, label: '3' }, { v: 5, label: '5' }].map(({ v, label }) => (
                    <button key={v} type="button" onClick={() => setQueueConcurrency(v)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        queueConcurrency === v ? 'bg-accent text-white border-transparent' : 'border-border text-text-muted hover:border-border-hover'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-text-secondary">Auto-start queue after creation</span>
                  <button type="button" onClick={() => setAutoStart(a => !a)}
                    className={`w-9 h-5 rounded-full transition-all relative ${autoStart ? 'bg-accent' : 'bg-bg-hover border border-border'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${autoStart ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Services */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-secondary">Services</label>
            <div className="flex items-center gap-2">
              {serviceCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-accent-muted text-accent-hover rounded-full">{serviceCount}</span>
              )}
              <div className="flex items-center gap-1 p-0.5 bg-bg-hover rounded-lg border border-border">
                <button type="button" onClick={() => setServicesMode('manual')}
                  className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                    servicesMode === 'manual' ? 'bg-bg-surface text-text-primary shadow-sm border border-border' : 'text-text-muted hover:text-text-secondary'}`}>
                  <List className="w-3 h-3" /> Manual
                </button>
                <button type="button" onClick={() => setServicesMode('predefined')}
                  className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all ${
                    servicesMode === 'predefined' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                  <Layers className="w-3 h-3" /> Predefined
                </button>
              </div>
            </div>
          </div>

          {servicesMode === 'manual' ? (
            <Textarea value={servicesText} onChange={e => setServicesText(e.target.value)}
              placeholder={"plumber\nelectrician\ndentist\nlawyer"} rows={5} hint="One service per line" />
          ) : predefinedServices.length === 0 ? (
            <div className="p-6 rounded-xl border border-border bg-bg-base text-center">
              <Layers className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-40" />
              <p className="text-sm text-text-secondary">No predefined services yet</p>
              <p className="text-xs text-text-muted mt-1">Go to Services page to add or import them</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-bg-base overflow-hidden">
              <div className="flex items-center gap-2 p-2 border-b border-border">
                <button type="button" onClick={toggleAllPredefined} className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
                  {selectedPredefined.size === filteredPredefined.length && filteredPredefined.length > 0
                    ? <CheckSquare className="w-4 h-4 text-accent" />
                    : <Square className="w-4 h-4" />}
                </button>
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input type="text" value={predefinedSearch} onChange={e => setPredefinedSearch(e.target.value)}
                    placeholder="Search services…"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30" />
                </div>
                {selectedPredefined.size > 0 && (
                  <span className="text-xs text-accent-hover font-medium flex-shrink-0">{selectedPredefined.size} selected</span>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-border/50">
                {filteredPredefined.map(svc => (
                  <div key={svc.id} onClick={() => togglePredefined(svc.name)}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors text-xs ${
                      selectedPredefined.has(svc.name) ? 'bg-accent-muted' : 'hover:bg-bg-hover'}`}>
                    {selectedPredefined.has(svc.name)
                      ? <CheckSquare className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      : <Square className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
                    <span className="text-text-primary">{svc.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Locations */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-secondary">Locations</label>
            <div className="flex items-center gap-1 p-0.5 bg-bg-hover rounded-lg border border-border">
              <button type="button" onClick={() => setLocationMode('manual')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  locationMode === 'manual' ? 'bg-bg-surface text-text-primary shadow-sm border border-border' : 'text-text-muted hover:text-text-secondary'}`}>
                <List className="w-3 h-3" /> Manual
              </button>
              <button type="button" onClick={() => setLocationMode('geohash')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  locationMode === 'geohash' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <Map className="w-3 h-3" /> Geohash
              </button>
            </div>
          </div>

          {locationMode === 'manual' ? (
            <div className="space-y-1.5">
              {locationCount > 0 && (
                <div className="flex justify-end">
                  <span className="text-xs px-2 py-0.5 bg-accent-muted text-accent-hover rounded-full">{locationCount}</span>
                </div>
              )}
              <Textarea value={locationsText} onChange={e => setLocationsText(e.target.value)}
                placeholder={"Warsaw, Poland\nKrakow, Poland\nGdansk, Poland"} rows={4} hint="One location per line" />
            </div>
          ) : (
            <div className="space-y-4 p-4 rounded-xl border border-border bg-bg-base">
              <div>
                <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Area</p>
                <div className="grid grid-cols-4 gap-2">
                  {REGIONS.map(r => (
                    <button key={r.value} type="button" onClick={() => setGeohashRegion(r.value)}
                      className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-all ${
                        geohashRegion === r.value ? 'bg-accent-muted border-border-active text-accent-hover' : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'}`}>
                      <span className="text-lg leading-none">{r.flag}</span>
                      {r.label}
                    </button>
                  ))}
                </div>
                {geohashRegion === 'custom' && (
                  <input type="text" value={customBbox} onChange={e => setCustomBbox(e.target.value)}
                    placeholder="minLat,maxLat,minLng,maxLng  e.g. 49,55,14,24"
                    className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active" />
                )}
              </div>
              <div>
                <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Precision</p>
                <div className="grid grid-cols-3 gap-2">
                  {PRECISIONS.map(p => (
                    <button key={p.value} type="button" onClick={() => setGeohashPrecision(p.value)}
                      className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                        geohashPrecision === p.value ? 'bg-accent-muted border-border-active text-accent-hover' : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'}`}>
                      <span className="font-semibold">{p.label}</span>
                      <span className="text-text-muted font-normal">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {tileCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-hover rounded-lg px-3 py-2">
                  <Map className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span><span className="font-semibold text-text-primary">{tileCount.toLocaleString()}</span> tiles covering the selected area</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Task preview */}
        {totalTasks > 0 && (
          <div className="flex items-center gap-3 p-3 bg-accent-muted border border-border-active rounded-lg">
            <Zap className="w-4 h-4 text-accent flex-shrink-0" />
            <p className="text-sm text-text-secondary">
              {campaignMode === 'split' ? (
                <>Will create <span className="font-semibold text-text-primary">{serviceCount} campaigns</span>{' '}
                × {locationMode === 'geohash' ? `${tileCount.toLocaleString()} tiles` : `${locationCount} locations`}</>
              ) : (
                <>Will create <span className="font-semibold text-text-primary">{totalTasks.toLocaleString()} tasks</span>
                {' '}({serviceCount} service{serviceCount !== 1 ? 's' : ''} × {locationMode === 'geohash'
                  ? `${tileCount.toLocaleString()} tiles` : `${locationCount} location${locationCount !== 1 ? 's' : ''}`})</>
              )}
            </p>
          </div>
        )}

        {/* Concurrency */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-text-secondary">
              Parallel Browsers
              <span className="ml-2 text-xs text-text-muted">(higher = faster, more RAM)</span>
            </label>
            <span className={`text-sm font-bold tabular-nums ${concurrency > 10 ? 'text-warning' : 'text-accent'}`}>{concurrency}×</span>
          </div>
          {customMode ? (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={500} autoFocus value={customValue}
                onChange={e => setCustomValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyCustom(); if (e.key === 'Escape') setCustomMode(false); }}
                placeholder="Enter number (1–500)"
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-base border border-border-active text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums" />
              <button type="button" onClick={applyCustom} className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors font-medium">Apply</button>
              <button type="button" onClick={() => setCustomMode(false)} className="px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:border-border-hover transition-colors">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => handleConcurrencyChange(Math.max(1, concurrency - 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all">
                <Minus className="w-3.5 h-3.5" />
              </button>
              {[1, 2, 3, 5, 10, 20, 50].map(n => (
                <button key={n} type="button" onClick={() => handleConcurrencyChange(n)}
                  className={`min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium transition-all ${
                    concurrency === n && !customMode ? 'bg-accent text-white shadow-glow-sm' : 'border border-border text-text-secondary hover:border-border-hover hover:text-text-primary'}`}>
                  {n}
                </button>
              ))}
              <button type="button" onClick={() => handleConcurrencyChange(concurrency + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => { setCustomMode(true); setCustomValue(String(concurrency)); }}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border transition-all ${
                  ![1,2,3,5,10,20,50].includes(concurrency) ? 'bg-accent-muted border-border-active text-accent-hover' : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'}`}>
                <Pencil className="w-3 h-3" />
                {![1,2,3,5,10,20,50].includes(concurrency) ? `Custom (${concurrency})` : 'Custom'}
              </button>
            </div>
          )}
          {concurrency > 20 && (
            <p className="text-xs text-warning mt-2 flex items-center gap-1.5">
              ⚠ {concurrency} browsers require significant RAM (~{concurrency * 200}MB+). Recommended only with a proxy.
            </p>
          )}
        </div>

        {/* Enrichment */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-bg-base">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-success" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Website Enrichment</p>
              <p className="text-xs text-text-muted">Auto-scrape websites to find emails</p>
            </div>
          </div>
          <button type="button" onClick={() => setEnrichmentEnabled(!enrichmentEnabled)}
            className={`w-11 h-6 rounded-full transition-all duration-200 relative ${enrichmentEnabled ? 'bg-accent' : 'bg-bg-hover border border-border'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${enrichmentEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button type="submit" loading={isPending} icon={<Zap className="w-4 h-4" />}>
            {campaignMode === 'split'
              ? `Create ${serviceCount > 0 ? serviceCount + ' ' : ''}Campaigns`
              : 'Create Campaign'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
