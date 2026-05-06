import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { AiModelCatalog, AiModelCatalogModel, AiModelCatalogProvider } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { withTimeout } from '../../utils/promiseTimeout.js';

const MODELS_URL = process.env.OPENTALES_MODELS_URL ?? 'https://models.dev/api.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TIMEOUT_MS = 10_000;
const LATEST_WINDOW_MS = 183 * 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(os.homedir(), '.cache', 'opentales', 'models.json');
const POPULAR_PROVIDERS = [
  'github-copilot',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'vercel'
];

let memoryCache: { loadedAt: number; catalog: AiModelCatalog } | null = null;

export class ProjectAiModelsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string): Promise<AiModelCatalog> {
    await withTimeout(
      this.access.assertProjectAccess(userId, projectId),
      ACCESS_TIMEOUT_MS,
      'Timed out while checking project access'
    );
    return loadCatalog();
  }
}

async function loadCatalog(): Promise<AiModelCatalog> {
  if (memoryCache && Date.now() - memoryCache.loadedAt < CACHE_TTL_MS) return memoryCache.catalog;

  const cached = await readDiskCache();
  if (cached) {
    memoryCache = { loadedAt: Date.now(), catalog: cached };
    return cached;
  }

  try {
    const response = await fetch(MODELS_URL, {
      headers: { 'User-Agent': 'opentales' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
    const raw = await response.json() as Record<string, unknown>;
    await writeDiskCache(raw);
    const catalog = normalizeCatalog(raw);
    memoryCache = { loadedAt: Date.now(), catalog };
    return catalog;
  } catch {
    return memoryCache?.catalog ?? { providers: [], updatedAt: new Date().toISOString(), source: 'unavailable' };
  }
}

async function readDiskCache(): Promise<AiModelCatalog | null> {
  try {
    const stat = await fs.stat(CACHE_PATH);
    if (Date.now() - stat.mtimeMs >= CACHE_TTL_MS) return null;
    const text = await fs.readFile(CACHE_PATH, 'utf8');
    return normalizeCatalog(JSON.parse(text) as Record<string, unknown>, stat.mtime.toISOString());
  } catch {
    return null;
  }
}

async function writeDiskCache(raw: Record<string, unknown>) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(raw), 'utf8');
}

function normalizeCatalog(raw: Record<string, unknown>, updatedAt = new Date().toISOString()): AiModelCatalog {
  const providers = Object.entries(raw)
    .map(([providerId, value]) => normalizeProvider(providerId, value))
    .filter((provider): provider is AiModelCatalogProvider => Boolean(provider));
  markLatestModels(providers);
  return { providers: providers.sort(compareProviders), updatedAt, source: 'models.dev' };
}

function normalizeProvider(providerId: string, value: unknown): AiModelCatalogProvider | null {
  if (!isRecord(value)) return null;
  const models = isRecord(value.models)
    ? Object.entries(value.models)
        .map(([modelId, model]) => normalizeModel(providerId, modelId, model))
        .filter((model): model is AiModelCatalogModel => Boolean(model))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  if (models.length === 0) return null;

  return {
    id: providerId,
    name: stringValue(value.name) ?? providerId,
    api: stringValue(value.api) ?? null,
    npm: stringValue(value.npm) ?? null,
    popular: POPULAR_PROVIDERS.includes(providerId),
    models
  };
}

function normalizeModel(providerId: string, modelId: string, value: unknown): AiModelCatalogModel | null {
  if (!isRecord(value)) return null;
  const provider = isRecord(value.provider) ? value.provider : {};
  const releaseDate = stringValue(value.release_date) ?? stringValue(value.releaseDate) ?? null;
  const cost = isRecord(value.cost) ? value.cost : null;
  const limit = isRecord(value.limit) ? value.limit : null;

  return {
    id: modelId,
    providerId,
    name: stringValue(value.name) ?? modelId,
    family: stringValue(value.family) ?? modelId.split(/[\-._]/)[0] ?? modelId,
    releaseDate,
    status: stringValue(value.status) ?? 'active',
    api: {
      id: stringValue(value.id) ?? modelId,
      url: stringValue(provider.api) ?? null,
      npm: stringValue(provider.npm) ?? null
    },
    cost: cost ? { input: numberValue(cost.input), output: numberValue(cost.output) } : null,
    context: numberValue(value.context) ?? (limit ? numberValue(limit.context) : null),
    maxOutput: numberValue(value.max_output) ?? (limit ? numberValue(limit.output) : null),
    supportsTools: Boolean(value.tool_call ?? value.tools),
    supportsVision: Boolean(value.vision ?? value.attachment),
    latest: false,
    visible: false
  };
}

function markLatestModels(providers: AiModelCatalogProvider[]) {
  const now = Date.now();
  for (const provider of providers) {
    const latestByFamily = new Map<string, AiModelCatalogModel>();
    for (const model of provider.models) {
      const releasedAt = releaseTime(model.releaseDate);
      if (releasedAt === null || now - releasedAt > LATEST_WINDOW_MS) continue;
      const current = latestByFamily.get(model.family);
      if (!current || releasedAt > (releaseTime(current.releaseDate) ?? 0)) latestByFamily.set(model.family, model);
    }

    for (const model of provider.models) {
      const releasedAt = releaseTime(model.releaseDate);
      model.latest = latestByFamily.get(model.family)?.id === model.id;
      model.visible = model.latest || releasedAt === null;
    }
  }
}

function releaseTime(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareProviders(a: AiModelCatalogProvider, b: AiModelCatalogProvider): number {
  const aRank = POPULAR_PROVIDERS.indexOf(a.id);
  const bRank = POPULAR_PROVIDERS.indexOf(b.id);
  if (aRank >= 0 && bRank < 0) return -1;
  if (aRank < 0 && bRank >= 0) return 1;
  if (aRank >= 0 && bRank >= 0) return aRank - bRank;
  return a.name.localeCompare(b.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
