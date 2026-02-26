'use client';

import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type PredefinedService, type PreviewResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Layers, Plus, Trash2, Upload, Search, X, CheckSquare, Square, FileText, Table } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/modal';

export default function ServicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Import wizard state
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [importStep, setImportStep] = useState<'upload' | 'preview'>('upload');
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['predefined-services'],
    queryFn: api.predefinedServices.list,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter((s: PredefinedService) => s.name.toLowerCase().includes(q));
  }, [services, search]);

  const addMutation = useMutation({
    mutationFn: (names: string[]) => api.predefinedServices.add(names),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['predefined-services'] });
      toast.success(`Added ${res.imported} services`);
      setAddText('');
      setAddOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.predefinedServices.deleteBulk(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['predefined-services'] });
      setSelected(new Set());
      toast.success('Deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s: PredefinedService) => s.id)));
    }
  };

  const handleAdd = () => {
    const names = addText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) return;
    addMutation.mutate(names);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setPreviewing(true);
    try {
      const result = await api.predefinedServices.preview(file);
      setPreviewData(result);
      setSelectedColumn(0);
      setImportStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Parse error');
    } finally {
      setPreviewing(false);
    }
    // Reset input so same file can be re-selected
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const res = await api.predefinedServices.import(importFile, selectedColumn);
      qc.invalidateQueries({ queryKey: ['predefined-services'] });
      toast.success(`Imported ${res.imported} services`);
      setImportOpen(false);
      setPreviewData(null);
      setImportFile(null);
      setImportStep('upload');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const closeImport = () => {
    setImportOpen(false);
    setPreviewData(null);
    setImportFile(null);
    setImportStep('upload');
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Layers className="w-5 h-5 text-accent" />
            <h1 className="text-2xl font-bold text-text-primary">Predefined Services</h1>
          </div>
          <p className="text-sm text-text-secondary">
            {services.length} service{services.length !== 1 ? 's' : ''} in library — use in campaign creation
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="ghost"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => deleteMutation.mutate(Array.from(selected))}
              loading={deleteMutation.isPending}
              className="text-danger hover:text-danger"
            >
              Delete {selected.size}
            </Button>
          )}
          <Button variant="ghost" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
            Import CSV/XLSX
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setAddOpen(true)}>
            Add Services
          </Button>
        </div>
      </div>

      {/* Search + select-all */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAll}
            className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            title={allSelected ? 'Deselect all' : 'Select all'}
          >
            {allSelected
              ? <CheckSquare className="w-4 h-4 text-accent" />
              : <Square className="w-4 h-4" />}
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search services…"
              className="w-full pl-9 pr-9 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {search && (
            <span className="text-xs text-text-muted flex-shrink-0">{filtered.length} results</span>
          )}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="glass-card divide-y divide-border">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="skeleton w-4 h-4 rounded" />
              <div className="skeleton h-4 w-48 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Layers className="w-10 h-10 text-text-muted mx-auto mb-3 opacity-40" />
          <p className="text-text-secondary font-medium">
            {search ? 'No services match your search' : 'No predefined services yet'}
          </p>
          {!search && (
            <p className="text-sm text-text-muted mt-1">Import a CSV/XLSX or add services manually</p>
          )}
        </div>
      ) : (
        <div className="glass-card divide-y divide-border overflow-hidden">
          {filtered.map((svc: PredefinedService) => (
            <div
              key={svc.id}
              onClick={() => toggleSelect(svc.id)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                selected.has(svc.id) ? 'bg-accent-muted' : 'hover:bg-bg-hover'
              }`}
            >
              <div className="flex-shrink-0 text-text-muted">
                {selected.has(svc.id)
                  ? <CheckSquare className="w-4 h-4 text-accent" />
                  : <Square className="w-4 h-4" />}
              </div>
              <span className="text-sm text-text-primary">{svc.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add manually modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Services" size="md">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">One service name per line</p>
          <textarea
            rows={10}
            value={addText}
            onChange={e => setAddText(e.target.value)}
            placeholder={'dentist\nplumber\nlawyer\nelectrician'}
            className="w-full px-3 py-2 rounded-lg text-sm bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border-active font-mono resize-none"
            autoFocus
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">
              {addText.split('\n').filter(s => s.trim()).length} services
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} loading={addMutation.isPending} icon={<Plus className="w-4 h-4" />}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Import CSV/XLSX modal */}
      <Modal open={importOpen} onClose={closeImport} title="Import Services" size="lg">
        {importStep === 'upload' ? (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-border-active hover:bg-accent-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <Upload className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-text-primary">Click to upload CSV or XLSX</p>
              <p className="text-xs text-text-muted mt-1">First row treated as header / column names</p>
            </div>
            {previewing && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Parsing file…
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={closeImport}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <FileText className="w-4 h-4 text-accent" />
              <span className="font-medium">{importFile?.name}</span>
              <span className="text-text-muted">— {previewData?.total} rows</span>
            </div>

            {previewData && previewData.columns.length > 0 && (
              <div>
                <p className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Select column with service names</p>
                <div className="flex flex-wrap gap-2">
                  {previewData.columns.map((col, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedColumn(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        selectedColumn === i
                          ? 'bg-accent text-white border-transparent'
                          : 'border-border text-text-secondary hover:border-border-hover'
                      }`}
                    >
                      {col || `Column ${i + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {previewData && previewData.rows.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Table className="w-3.5 h-3.5 text-text-muted" />
                  <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Preview (first 10 rows)</p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg-hover">
                        {previewData.columns.map((col, i) => (
                          <th
                            key={i}
                            className={`px-3 py-2 text-left font-medium ${i === selectedColumn ? 'text-accent' : 'text-text-muted'}`}
                          >
                            {col || `Col ${i + 1}`}
                            {i === selectedColumn && <span className="ml-1 text-[10px]">✓</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {previewData.columns.map((_, ci) => (
                            <td
                              key={ci}
                              className={`px-3 py-1.5 ${ci === selectedColumn ? 'text-text-primary font-medium' : 'text-text-muted'}`}
                            >
                              {row[ci] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setImportStep('upload')}
                className="text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                ← Choose different file
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={closeImport}>Cancel</Button>
                <Button
                  onClick={handleImport}
                  loading={importing}
                  icon={<Upload className="w-4 h-4" />}
                >
                  Import {previewData?.total ?? ''} services
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
