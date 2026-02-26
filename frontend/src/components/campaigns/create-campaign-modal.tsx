'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { api, type CreateCampaignPayload } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Minus, Globe, Zap, Shield, Pencil, Map, List } from 'lucide-react';

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
  const [name, setName] = useState('');
  const [servicesText, setServicesText] = useState('');
  const [locationsText, setLocationsText] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [enrichmentEnabled, setEnrichmentEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Geohash mode state
  const [locationMode, setLocationMode] = useState<'manual' | 'geohash'>('manual');
  const [geohashRegion, setGeohashRegion] = useState<string>('poland');
  const [geohashPrecision, setGeohashPrecision] = useState(4);
  const [customBbox, setCustomBbox] = useState('');

  const effectiveArea = geohashRegion === 'custom' ? customBbox : geohashRegion;

  // Live tile count from backend
  const { data: tileData } = useQuery({
    queryKey: ['geohash-count', effectiveArea, geohashPrecision],
    queryFn: () => api.geohash.count(effectiveArea, geohashPrecision),
    enabled: locationMode === 'geohash' && effectiveArea.trim() !== '' && effectiveArea !== 'custom',
    staleTime: 60_000,
  });

  const handleConcurrencyChange = (n: number) => {
    setConcurrency(n);
    setCustomMode(false);
    setCustomValue('');
  };

  const applyCustom = () => {
    const n = parseInt(customValue, 10);
    if (n >= 1) {
      setConcurrency(n);
      setCustomMode(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateCampaignPayload) => api.campaigns.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      toast.success('Campaign created successfully');
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create campaign');
    },
  });

  const handleClose = () => {
    setName('');
    setServicesText('');
    setLocationsText('');
    setConcurrency(2);
    setCustomMode(false);
    setCustomValue('');

    setEnrichmentEnabled(true);
    setShowAdvanced(false);
    setLocationMode('manual');
    setGeohashRegion('poland');
    setGeohashPrecision(4);
    setCustomBbox('');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const services = servicesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!name.trim()) return toast.error('Campaign name is required');
    if (services.length === 0) return toast.error('Add at least one service');

    if (locationMode === 'geohash') {
      if (!effectiveArea || effectiveArea === 'custom') {
        return toast.error('Enter a custom bounding box (minLat,maxLat,minLng,maxLng)');
      }
      createMutation.mutate({
        name: name.trim(),
        services,
        concurrency,
        enrichment_enabled: enrichmentEnabled,
        geohash_mode: true,
        geohash_area: effectiveArea,
        geohash_precision: geohashPrecision,
      });
    } else {
      const locations = locationsText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (locations.length === 0) return toast.error('Add at least one location');
      createMutation.mutate({
        name: name.trim(),
        services,
        locations,
        concurrency,
        enrichment_enabled: enrichmentEnabled,
      });
    }
  };

  const serviceCount = servicesText.split('\n').filter((s) => s.trim()).length;
  const locationCount = locationsText.split('\n').filter((l) => l.trim()).length;
  const tileCount = tileData?.count ?? 0;
  const totalTasks = locationMode === 'geohash'
    ? serviceCount * tileCount
    : serviceCount * locationCount;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Campaign"
      description="Configure your Google Maps scraping campaign"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Campaign name */}
        <Input
          label="Campaign Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Plumbers in Poland Q1 2025"
          autoFocus
        />

        {/* Services */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-secondary">Services</label>
            {serviceCount > 0 && (
              <span className="text-xs px-2 py-0.5 bg-accent-muted text-accent-hover rounded-full">
                {serviceCount}
              </span>
            )}
          </div>
          <Textarea
            value={servicesText}
            onChange={(e) => setServicesText(e.target.value)}
            placeholder={"plumber\nelectrician\ndentist\nlawyer"}
            rows={5}
            hint="One service per line"
          />
        </div>

        {/* Locations — mode toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-secondary">Locations</label>
            <div className="flex items-center gap-1 p-0.5 bg-bg-hover rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setLocationMode('manual')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  locationMode === 'manual'
                    ? 'bg-bg-surface text-text-primary shadow-sm border border-border'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <List className="w-3 h-3" /> Manual
              </button>
              <button
                type="button"
                onClick={() => setLocationMode('geohash')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  locationMode === 'geohash'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Map className="w-3 h-3" /> Geohash
              </button>
            </div>
          </div>

          {locationMode === 'manual' ? (
            <div className="space-y-1.5">
              {locationCount > 0 && (
                <div className="flex justify-end">
                  <span className="text-xs px-2 py-0.5 bg-accent-muted text-accent-hover rounded-full">
                    {locationCount}
                  </span>
                </div>
              )}
              <Textarea
                value={locationsText}
                onChange={(e) => setLocationsText(e.target.value)}
                placeholder={"Warsaw, Poland\nKrakow, Poland\nGdansk, Poland\nWroclaw, Poland"}
                rows={5}
                hint="One location per line"
              />
            </div>
          ) : (
            <div className="space-y-4 p-4 rounded-xl border border-border bg-bg-base">
              {/* Region selector */}
              <div>
                <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Area</p>
                <div className="grid grid-cols-4 gap-2">
                  {REGIONS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setGeohashRegion(r.value)}
                      className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-all ${
                        geohashRegion === r.value
                          ? 'bg-accent-muted border-border-active text-accent-hover'
                          : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                      }`}
                    >
                      <span className="text-lg leading-none">{r.flag}</span>
                      {r.label}
                    </button>
                  ))}
                </div>
                {geohashRegion === 'custom' && (
                  <input
                    type="text"
                    value={customBbox}
                    onChange={(e) => setCustomBbox(e.target.value)}
                    placeholder="minLat,maxLat,minLng,maxLng  e.g. 49,55,14,24"
                    className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
                  />
                )}
              </div>

              {/* Precision selector */}
              <div>
                <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Precision</p>
                <div className="grid grid-cols-3 gap-2">
                  {PRECISIONS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setGeohashPrecision(p.value)}
                      className={`flex flex-col items-center gap-0.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                        geohashPrecision === p.value
                          ? 'bg-accent-muted border-border-active text-accent-hover'
                          : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                      }`}
                    >
                      <span className="font-semibold">{p.label}</span>
                      <span className="text-text-muted font-normal">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tile count preview */}
              {tileCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-hover rounded-lg px-3 py-2">
                  <Map className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span>
                    <span className="font-semibold text-text-primary">{tileCount.toLocaleString()}</span> tiles covering the selected area
                  </span>
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
              Will create{' '}
              <span className="font-semibold text-text-primary">{totalTasks.toLocaleString()} tasks</span>
              {locationMode === 'geohash'
                ? ` (${serviceCount} service${serviceCount !== 1 ? 's' : ''} × ${tileCount.toLocaleString()} tiles)`
                : ` (${serviceCount} service${serviceCount !== 1 ? 's' : ''} × ${locationCount} location${locationCount !== 1 ? 's' : ''})`
              }
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
            <span className={`text-sm font-bold tabular-nums ${concurrency > 10 ? 'text-warning' : 'text-accent'}`}>
              {concurrency}×
            </span>
          </div>

          {customMode ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                autoFocus
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCustom(); if (e.key === 'Escape') setCustomMode(false); }}
                placeholder="Enter number (1–500)"
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-base border border-border-active text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums"
              />
              <button
                type="button"
                onClick={applyCustom}
                className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors font-medium"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setCustomMode(false)}
                className="px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:border-border-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleConcurrencyChange(Math.max(1, concurrency - 1))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              {[1, 2, 3, 5, 10, 20, 50].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleConcurrencyChange(n)}
                  className={`min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium transition-all ${
                    concurrency === n && !customMode
                      ? 'bg-accent text-white shadow-glow-sm'
                      : 'border border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
                  }`}
                >
                  {n}
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleConcurrencyChange(concurrency + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => { setCustomMode(true); setCustomValue(String(concurrency)); }}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border transition-all ${
                  ![1,2,3,5,10,20,50].includes(concurrency)
                    ? 'bg-accent-muted border-border-active text-accent-hover'
                    : 'border-border text-text-muted hover:border-border-hover hover:text-text-secondary'
                }`}
              >
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

        {/* Enrichment toggle */}
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
          <button
            type="button"
            onClick={() => setEnrichmentEnabled(!enrichmentEnabled)}
            className={`w-11 h-6 rounded-full transition-all duration-200 relative ${
              enrichmentEnabled ? 'bg-accent' : 'bg-bg-hover border border-border'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
                enrichmentEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Advanced */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={createMutation.isPending}
            icon={<Zap className="w-4 h-4" />}
          >
            Create Campaign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
