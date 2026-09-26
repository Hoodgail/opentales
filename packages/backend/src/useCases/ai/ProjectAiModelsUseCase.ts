import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { AiModelCatalog, AiModelCatalogModel, AiModelCatalogProvider, DiscoverAiModelsInput } from '@opentales/sdk';
import { z } from 'zod';
import { decryptSecret } from '../../utils/secretBox.js';
import { normalizeOpenAiBaseUrl, type ProjectProviderSettings } from './opencode/providers.js';
import { providerModelCatalog } from './providerModels.js';
import { normalizeModel } from './modelMetadata.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { withTimeout } from '../../utils/promiseTimeout.js';
import {
  CODEX_API_ENDPOINT,
  isCodexModelAllowed,
  usesCodexExtendedLimits
} from './codexModels.js';

const MODELS_URL = process.env.OPENTALES_MODELS_URL ?? 'https://models.dev/api.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TIMEOUT_MS = 10_000;
const LATEST_WINDOW_MS = 183 * 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(os.homedir(), '.cache', 'opentales', 'models.json');
const POPULAR_PROVIDERS = [
  'github-copilot',
  'codex',
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

  async list(userId: string, projectId: string, referenceOnly = false): Promise<AiModelCatalog> {
    await withTimeout(
      this.access.assertProjectAccess(userId, projectId),
      ACCESS_TIMEOUT_MS,
      'Timed out while checking project access'
    );
    if (referenceOnly) return loadCatalog();
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId } });
    return loadProjectCatalog(projectId, settings);
  }

  async discover(userId: string, projectId: string, input: DiscoverAiModelsInput): Promise<AiModelCatalog> {
    await this.access.assertPermission(userId, projectId, 'project:admin');
    const parsed = z.object({ baseUrl: z.string().trim().min(1).max(2048), apiKey: z.string().max(8192).nullable().optional() }).parse(input);
    const baseUrl = normalizeOpenAiBaseUrl(parsed.baseUrl);
    const settings = await this.prisma.projectAiSettings.findUnique({ where: { projectId } });
    // Unsaved endpoint edits must not receive a key belonging to the saved host.
    const reuse = settings?.providerKind === 'OPENAI_COMPATIBLE'
      && normalizeOpenAiBaseUrl(settings.baseUrl ?? 'https://api.openai.com/v1') === baseUrl;
    const apiKey = parsed.apiKey !== undefined ? parsed.apiKey : reuse && settings.apiKey ? decryptSecret(settings.apiKey) : null;
    return providerModelCatalog(`${projectId}:preview`, baseUrl, apiKey, loadCatalog, true);
  }
}

export function loadProjectCatalog(projectId: string, settings: ProjectProviderSettings | null): Promise<AiModelCatalog> {
  if (settings?.providerKind === 'OPENAI_COMPATIBLE' && settings.baseUrl) {
    return providerModelCatalog(projectId, settings.baseUrl, settings.apiKey ? decryptSecret(settings.apiKey) : null, loadCatalog);
  }
  return loadCatalog();
}

export async function loadCatalog(): Promise<AiModelCatalog> {
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
    const catalog = normalizeCatalog(raw);
    if (!catalog.providers.length) throw new Error('models.dev returned an empty catalog');
    await writeDiskCache(raw).catch(() => undefined);
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
    const catalog = normalizeCatalog(JSON.parse(text) as Record<string, unknown>, stat.mtime.toISOString());
    return catalog.providers.length ? catalog : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(raw: Record<string, unknown>) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(raw), 'utf8');
}

export function normalizeCatalog(raw: Record<string, unknown>, updatedAt = new Date().toISOString()): AiModelCatalog {
  const providers = Object.entries(raw)
    .map(([providerId, value]) => normalizeProvider(providerId, value))
    .filter((provider): provider is AiModelCatalogProvider => Boolean(provider));
  markLatestModels(providers);
  const codex = createCodexCatalogProvider(providers);
  if (codex) providers.push(codex);
  return { providers: providers.sort(compareProviders), updatedAt, source: 'models.dev' };
}

export function createCodexCatalogProvider(
  providers: AiModelCatalogProvider[]
): AiModelCatalogProvider | null {
  const openai = providers.find((provider) => provider.id === 'openai');
  if (!openai) return null;
  const models = openai.models
    .filter((model) => isCodexModelAllowed(model.api.id || model.id))
    .map((model) => {
      const extendedLimits = usesCodexExtendedLimits(model.api.id || model.id);
      return {
        ...model,
        providerId: 'codex',
        api: { id: model.api.id || model.id, url: CODEX_API_ENDPOINT, npm: '@ai-sdk/openai' },
        cost: { input: 0, output: 0 },
        context: extendedLimits ? 400_000 : model.context,
        maxInput: extendedLimits ? 272_000 : model.maxInput,
        maxOutput: extendedLimits ? 128_000 : model.maxOutput,
        visible: true
      } satisfies AiModelCatalogModel;
    });
  if (!models.length) return null;
  return {
    id: 'codex',
    name: 'Codex (ChatGPT)',
    api: CODEX_API_ENDPOINT,
    npm: '@ai-sdk/openai',
    popular: true,
    models
  };
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
