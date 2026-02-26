'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Campaign } from '@/lib/api';
import { Save, Minus, Plus, Globe, Info } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  campaign: Campaign | null;
  onClose: () => void;
}

export function EditCampaignModal({ campaign, onClose }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [enrichment, setEnrichment] = useState(true);

  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setConcurrency(campaign.concurrency);
      setEnrichment(campaign.enrichment_enabled);
    }
  }, [campaign]);

  const mutation = useMutation({
    mutationFn: () =>
      api.campaigns.update(campaign!.id, {
        name: name.trim(),
        concurrency,
        enrichment_enabled: enrichment,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    mutation.mutate();
  };

  const isRunning = campaign?.status === 'running';

  return (
    <Modal
      open={!!campaign}
      onClose={onClose}
      title="Edit Campaign"
      description={campaign?.name}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Campaign Name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />

        {/* Concurrency */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-text-secondary">
              Parallel Browsers
            </label>
            <span className={`text-sm font-bold tabular-nums ${concurrency > 10 ? 'text-warning' : 'text-accent'}`}>
              {concurrency}×
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setConcurrency(c => Math.max(1, c - 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            {[1, 2, 3, 5, 10, 20].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setConcurrency(n)}
                className={`min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium transition-all ${
                  concurrency === n
                    ? 'bg-accent text-white'
                    : 'border border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setConcurrency(c => c + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:border-border-hover hover:bg-bg-hover text-text-secondary transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {isRunning && (
            <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              Concurrency changes apply after next start
            </div>
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
            onClick={() => setEnrichment(e => !e)}
            className={`w-11 h-6 rounded-full transition-all duration-200 relative ${
              enrichment ? 'bg-accent' : 'bg-bg-hover border border-border'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${enrichment ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} icon={<Save className="w-4 h-4" />}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
