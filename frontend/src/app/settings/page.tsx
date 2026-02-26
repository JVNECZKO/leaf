'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Cpu, Globe, Info, RefreshCw, Save, Zap } from 'lucide-react';

const SETTING_FIELDS = [
  {
    key: 'MAX_BROWSERS',
    label: 'Max Browsers',
    type: 'number' as const,
    min: 1,
    max: 20,
    requiresRestart: true,
    desc: 'Maximum parallel Chrome instances for scraping',
  },
  {
    key: 'ENRICHMENT_WORKERS',
    label: 'Enrichment Workers',
    type: 'number' as const,
    min: 1,
    max: 100,
    requiresRestart: false,
    desc: 'Concurrent website enrichment workers — changes apply immediately',
  },
  {
    key: 'HEADLESS',
    label: 'Headless Mode',
    type: 'toggle' as const,
    requiresRestart: true,
    desc: 'Run Chrome without a visible window',
  },
];

export default function SettingsPage() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.list,
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      settings.forEach(s => { map[s.key] = s.value; });
      setValues(map);
    }
  }, [settings]);

  const set = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.settings.update(values);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-sm text-text-secondary mt-1">Platform configuration</p>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-danger">{error}</span>}
          {saved && <span className="text-xs text-success font-medium">Saved!</span>}
          <Button
            onClick={handleSave}
            disabled={saving || isLoading}
            icon={saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Scraper Settings */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-success/10 rounded-lg flex items-center justify-center">
              <Cpu className="w-4 h-4 text-success" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Scraper Settings</h2>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="skeleton h-20 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {SETTING_FIELDS.map(field => (
                <div key={field.key} className="p-4 bg-bg-base rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-text-primary">{field.label}</label>
                      {field.requiresRestart ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">
                          restart required
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> live
                        </span>
                      )}
                    </div>
                    <code className="text-[10px] font-mono text-text-muted bg-bg-surface px-1.5 py-0.5 rounded">
                      {field.key}
                    </code>
                  </div>
                  <p className="text-xs text-text-muted mb-3">{field.desc}</p>

                  {field.type === 'toggle' ? (
                    <button
                      type="button"
                      onClick={() => set(field.key, values[field.key] === 'true' ? 'false' : 'true')}
                      className="flex items-center gap-3"
                    >
                      <div className={`relative w-10 h-5 rounded-full transition-colors ${
                        values[field.key] === 'true' ? 'bg-accent' : 'bg-bg-hover'
                      }`}>
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          values[field.key] === 'true' ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                      <span className="text-sm text-text-secondary">
                        {values[field.key] === 'true' ? 'Enabled' : 'Disabled'}
                      </span>
                    </button>
                  ) : (
                    <input
                      type={field.type}
                      value={values[field.key] ?? ''}
                      onChange={e => set(field.key, e.target.value)}
                      min={'min' in field ? field.min : undefined}
                      max={'max' in field ? field.max : undefined}
                      placeholder={'placeholder' in field ? (field as { placeholder: string }).placeholder : undefined}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Proxy Settings */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-[#A78BFA]/10 rounded-lg flex items-center justify-center">
              <Globe className="w-4 h-4 text-[#A78BFA]" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Proxy Settings</h2>
          </div>

          {/* PROXY_LIST */}
          <div className="p-4 bg-bg-base rounded-lg border border-border mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-primary">Proxy List</label>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> live
                </span>
              </div>
              {(() => {
                const count = (values['PROXY_LIST'] ?? '').split('\n').filter(l => l.trim()).length;
                return count > 0 ? (
                  <span className="text-xs text-text-muted">{count} {count === 1 ? 'proxy' : 'proxies'} loaded</span>
                ) : null;
              })()}
            </div>
            <p className="text-xs text-text-muted mb-3">One proxy per line: http://user:pass@host:port</p>
            <textarea
              rows={5}
              value={values['PROXY_LIST'] ?? ''}
              onChange={e => set('PROXY_LIST', e.target.value)}
              placeholder={'http://user:pass@proxy1.example.com:10000\nhttp://user:pass@proxy2.example.com:10000'}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active font-mono resize-none"
            />
          </div>

          {/* PROXY_ROTATION */}
          <div className="p-4 bg-bg-base rounded-lg border border-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-primary">Rotation</label>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success font-medium flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> live
                </span>
              </div>
            </div>
            <p className="text-xs text-text-muted mb-3">Rotate between proxies on each search (round-robin)</p>
            <button
              type="button"
              onClick={() => set('PROXY_ROTATION', values['PROXY_ROTATION'] === 'true' ? 'false' : 'true')}
              className="flex items-center gap-3"
            >
              <div className={`relative w-10 h-5 rounded-full transition-colors ${
                values['PROXY_ROTATION'] === 'true' ? 'bg-accent' : 'bg-bg-hover'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  values['PROXY_ROTATION'] === 'true' ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </div>
              <span className="text-sm text-text-secondary">
                {values['PROXY_ROTATION'] === 'true' ? 'Enabled' : 'Disabled'}
              </span>
            </button>
          </div>
        </div>

        {/* About */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-accent-muted rounded-lg flex items-center justify-center">
              <Info className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">About Leaf</h2>
          </div>
          <div className="space-y-2 text-sm text-text-secondary">
            <p>Leaf is a Google Maps lead scraping platform with automatic website enrichment.</p>
            <p className="text-text-muted">Scraper: Chromium headless · Enrichment: HTTP/goquery · Backend: Go · Frontend: Next.js</p>
          </div>
        </div>

        {/* Tips */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-[#A78BFA]/10 rounded-lg flex items-center justify-center">
              <Globe className="w-4 h-4 text-[#A78BFA]" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Tips for Best Results</h2>
          </div>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2"><span className="text-accent mt-0.5">→</span> Use specific service names (e.g., &quot;dentist&quot; not &quot;doctor&quot;)</li>
            <li className="flex items-start gap-2"><span className="text-accent mt-0.5">→</span> Include city + country for locations (e.g., &quot;Warsaw, Poland&quot;)</li>
            <li className="flex items-start gap-2"><span className="text-accent mt-0.5">→</span> Keep concurrency at 2–3 for residential IPs</li>
            <li className="flex items-start gap-2"><span className="text-accent mt-0.5">→</span> Enrichment runs automatically in the background</li>
            <li className="flex items-start gap-2"><span className="text-accent mt-0.5">→</span> Export leads as CSV at any time, even mid-scrape</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
