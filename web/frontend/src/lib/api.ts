import type {
  ApiResponse,
  InitializeRequest,
  GenerateRequest,
  CreateSampleRequest,
  FormatRequest,
  AnalyzeRequest,
  AnalyzeResponse,
} from './types';

const API_BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = err.error || err.detail || res.statusText;
    console.error(`[API ${options?.method || 'GET'} ${path}]`, msg);
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data.success) {
    console.error(`[API ${options?.method || 'GET'} ${path}]`, data.error);
  }
  return data;
}

// Service
export const getServiceStatus = () => request<any>('/service/status');
export const initializeService = (req: InitializeRequest) =>
  request<any>('/service/initialize', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const initializeLLM = (req: InitializeRequest) =>
  request<any>('/service/initialize-llm', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const getGPUConfig = () => request<any>('/service/gpu-config');

// Models
export const getDiTModels = () => request<string[]>('/models/dit');
export const getLMModels = () => request<string[]>('/models/lm');
export const getCheckpoints = () => request<string[]>('/models/checkpoints');

export const getModelInfo = () => request<any>('/models/info');
export const getModelDownloadStatus = () => request<any>('/models/download-status');
export const downloadModel = (modelName: string) =>
  request<any>(`/models/download/${modelName}`, { method: 'POST' });
export const downloadMainModel = () =>
  request<any>('/models/download-main', { method: 'POST' });

// Generation
export const startGeneration = (req: GenerateRequest) =>
  request<{ task_id: string }>('/generation/generate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const getTaskStatus = (taskId: string) =>
  request<any>(`/generation/task/${taskId}`);
export const createSample = (req: CreateSampleRequest) =>
  request<any>('/generation/create-sample', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const formatSample = (req: FormatRequest) =>
  request<any>('/generation/format', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const understandMusic = (req: any) =>
  request<any>('/generation/understand', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const analyzeLLM = (req: AnalyzeRequest) =>
  request<AnalyzeResponse>('/generation/analyze', {
    method: 'POST',
    body: JSON.stringify(req),
  });

// Audio
export const uploadAudio = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/audio/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json() as Promise<
    ApiResponse<{ id: string; filename: string }>
  >;
};
export const getAudioUrl = (fileId: string) =>
  `${API_BASE}/audio/files/${fileId}`;

// Latent
export const getLatentMetadata = (latentId: string) =>
  request<any>(`/generation/latent/${latentId}/metadata`);
export const decodeLatent = (latentId: string) =>
  request<{ audio_id: string; latent_id: string; sample_rate: number }>(
    `/generation/latent/${latentId}/decode`,
    { method: 'POST' }
  );
export const convertToCodes = (audioId: string) =>
  request<{ audio_codes: string }>('/audio/convert-to-codes', {
    method: 'POST',
    body: JSON.stringify({ audio_id: audioId }),
  });
export const calculateScore = (req: any) =>
  request<any>('/audio/score', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const generateLRC = (req: any) =>
  request<any>('/audio/lrc', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const downloadAllUrl = (taskId: string) =>
  `${API_BASE}/audio/download-all/${taskId}`;

// Audio metadata extraction (for importing songs)
export const getAudioMetadata = (fileId: string) =>
  request<{ has_metadata: boolean; metadata: any }>(`/audio/metadata/${fileId}`);

export const uploadAndExtractMetadata = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/audio/upload-and-extract`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json() as Promise<
    ApiResponse<{
      id: string;
      filename: string;
      has_metadata: boolean;
      metadata: any;
    }>
  >;
};

// LoRA
export const getLoRAStatus = () => request<any>('/lora/status');
export const loadLoRA = (path: string) =>
  request<any>('/lora/load', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
export const unloadLoRA = () =>
  request<any>('/lora/unload', { method: 'POST' });
export const enableLoRA = (enabled: boolean) =>
  request<any>('/lora/enable', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
export const setLoRAScale = (scale: number) =>
  request<any>('/lora/scale', {
    method: 'POST',
    body: JSON.stringify({ scale }),
  });

// Training
export const scanDataset = (directory: string) =>
  request<any>('/training/dataset/scan', {
    method: 'POST',
    body: JSON.stringify({ directory }),
  });
export const autoLabel = (indices?: number[]) =>
  request<any>('/training/dataset/auto-label', {
    method: 'POST',
    body: JSON.stringify({ indices }),
  });
export const getDatasetSamples = () =>
  request<any>('/training/dataset/samples');
export const editSample = (idx: number, edit: any) =>
  request<any>(`/training/dataset/sample/${idx}`, {
    method: 'PUT',
    body: JSON.stringify(edit),
  });
export const saveDataset = (path: string) =>
  request<any>('/training/dataset/save', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
export const loadDataset = (path: string) =>
  request<any>('/training/dataset/load', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
export const preprocessDataset = (output_dir: string) =>
  request<any>('/training/preprocess', {
    method: 'POST',
    body: JSON.stringify({ output_dir }),
  });
export const startTraining = (req: any) =>
  request<any>('/training/start', {
    method: 'POST',
    body: JSON.stringify(req),
  });
export const getTrainingStatus = () => request<any>('/training/status');
export const stopTraining = () =>
  request<any>('/training/stop', { method: 'POST' });
export const exportLoRA = (checkpoint_path: string, output_path: string) =>
  request<any>('/training/export', {
    method: 'POST',
    body: JSON.stringify({ checkpoint_path, output_path }),
  });

// Pipeline
export const runPipeline = (req: any) =>
  request<{ task_id: string }>('/generation/pipeline', {
    method: 'POST',
    body: JSON.stringify(req),
  });

// Examples
export const getRandomExample = (mode: string, taskType?: string) => {
  const params = new URLSearchParams({ mode });
  if (taskType) params.set('task_type', taskType);
  return request<any>(`/examples/random?${params}`);
};

// Prompt Library
export interface PromptEntry {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocal_language: string;
  bpm?: number;
  keyscale: string;
  timesignature: string;
  duration: number;
  genres: string[];
  tags: string[];
  mood: string;
  inference_steps?: number;
  guidance_scale?: number;
  shift?: number;
  notes: string;
}

export const listPrompts = (params?: {
  genres?: string;
  tags?: string;
  mood?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) => {
  const searchParams = new URLSearchParams();
  if (params?.genres) searchParams.set('genres', params.genres);
  if (params?.tags) searchParams.set('tags', params.tags);
  if (params?.mood) searchParams.set('mood', params.mood);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return request<{ prompts: PromptEntry[]; total: number }>(
    `/prompts/list${query ? '?' + query : ''}`
  );
};

export const getPromptTaxonomy = () =>
  request<{
    genres: string[];
    tags: string[];
    moods: string[];
    user_genres: string[];
    user_tags: string[];
  }>('/prompts/taxonomy');

export const getPrompt = (id: string) =>
  request<PromptEntry>(`/prompts/${id}`);

export const savePrompt = (prompt: Partial<PromptEntry> & { name: string; caption: string }) =>
  request<PromptEntry>('/prompts/save', {
    method: 'POST',
    body: JSON.stringify(prompt),
  });

export const updatePrompt = (id: string, updates: Partial<PromptEntry>) =>
  request<PromptEntry>(`/prompts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

export const deletePrompt = (id: string) =>
  request<{ deleted: boolean }>(`/prompts/${id}`, { method: 'DELETE' });

export const importPromptFromAudio = (audioId: string, name: string) =>
  request<PromptEntry>(`/prompts/import-from-audio/${audioId}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
  });
