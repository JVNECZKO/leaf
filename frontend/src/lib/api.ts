import { getToken, clearToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const API_URL = BASE_URL;
export const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function requestMultipart<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Types ---

export interface Campaign {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  concurrency: number;
  enrichment_enabled: boolean;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_leads: number;
  task_offset: number;
  services?: Service[];
  locations_count: number;
  geohash_mode: boolean;
  geohash_area: string;
  geohash_precision: number;
  batch_id?: string;
  queue_position?: number;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  campaign_id: string;
  name: string;
}

export interface Location {
  id: string;
  campaign_id: string;
  name: string;
}

export interface Task {
  id: string;
  campaign_id: string;
  service: string;
  location: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_msg: string;
  lead_count: number;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  task_id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  rating: string;
  review_count: string;
  maps_url: string;
  place_id: string;
  latitude: number;
  longitude: number;
  hours: string;
  social_links: string;
  extra_emails: string;
  enrich_status: 'none' | 'pending' | 'done' | 'failed';
  search_service: string;
  search_location: string;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  total_campaigns: number;
  running_campaigns: number;
  total_leads: number;
  total_with_email: number;
  total_with_phone: number;
  total_enriched: number;
}

export interface LeadsResponse {
  data: Lead[];
  total: number;
  page: number;
  page_size: number;
}

export interface Setting {
  key: string;
  value: string;
  description: string;
}

export interface PredefinedService {
  id: string;
  name: string;
  created_at: string;
}

export interface PreviewResult {
  columns: string[];
  rows: string[][];
  total: number;
}

export interface CreateCampaignPayload {
  name: string;
  services: string[];
  locations?: string[];
  concurrency: number;
  enrichment_enabled?: boolean;
  geohash_mode?: boolean;
  geohash_area?: string;
  geohash_precision?: number;
}

export interface CreateBatchPayload {
  services: string[];
  locations?: string[];
  location_mode: 'manual' | 'geohash';
  geohash_area?: string;
  geohash_precision?: number;
  concurrency: number;
  enrichment_enabled?: boolean;
  name_prefix?: string;
  queue_concurrency: number; // 0 = auto
  auto_start: boolean;
}

export interface BatchResult {
  batch_id: string;
  campaigns: Campaign[];
  count: number;
}

// --- API calls ---

export const api = {
  stats: () => request<Stats>('/stats'),

  campaigns: {
    list: () => request<Campaign[]>('/campaigns'),
    get: (id: string) => request<Campaign>(`/campaigns/${id}`),
    create: (data: CreateCampaignPayload) =>
      request<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
    createBatch: (data: CreateBatchPayload) =>
      request<BatchResult>('/campaigns/batch', { method: 'POST', body: JSON.stringify(data) }),
    stopAll: () => request<{ ok: boolean; stopped: number }>('/campaigns/stop-all', { method: 'POST' }),
    update: (id: string, data: { name: string; concurrency: number; enrichment_enabled: boolean }) =>
      request<{ ok: boolean }>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ ok: boolean }>(`/campaigns/${id}`, { method: 'DELETE' }),
    start: (id: string) => request<{ ok: boolean; status: string }>(`/campaigns/${id}/start`, { method: 'POST' }),
    stop: (id: string) => request<{ ok: boolean; status: string }>(`/campaigns/${id}/stop`, { method: 'POST' }),
    tasks: (id: string) => request<Task[]>(`/campaigns/${id}/tasks`),
    leads: (id: string, params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<LeadsResponse>(`/campaigns/${id}/leads${qs}`);
    },
    exportUrl: (id: string) => `${BASE_URL}/api/campaigns/${id}/leads/export`,
  },

  leads: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<LeadsResponse>(`/leads${qs}`);
    },
    exportUrl: () => `${BASE_URL}/api/leads/export`,
    delete: (id: string) =>
      request<{ ok: boolean }>(`/leads/${id}`, { method: 'DELETE' }),
    deleteBulk: (ids: string[]) =>
      request<{ ok: boolean; deleted: number }>('/leads', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      }),
  },

  predefinedServices: {
    list: () => request<PredefinedService[]>('/predefined-services'),
    add: (names: string[]) =>
      request<{ imported: number }>('/predefined-services', {
        method: 'POST',
        body: JSON.stringify({ names }),
      }),
    preview: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return requestMultipart<PreviewResult>('/predefined-services/preview', fd);
    },
    import: (file: File, column: number) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('column', String(column));
      return requestMultipart<{ imported: number }>('/predefined-services/import', fd);
    },
    deleteBulk: (ids: string[]) =>
      request<{ ok: boolean; deleted: number }>('/predefined-services', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      }),
  },

  settings: {
    list: () => request<Setting[]>('/settings'),
    update: (data: Record<string, string>) =>
      request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },

  auth: {
    login: (email: string, password: string) =>
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ token: string }>;
      }),
  },

  geohash: {
    count: (area: string, precision: number) =>
      request<{ count: number }>(`/geohash/tiles?area=${encodeURIComponent(area)}&precision=${precision}`),
  },
};
