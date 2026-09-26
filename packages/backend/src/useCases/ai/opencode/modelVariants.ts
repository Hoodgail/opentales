import type { AiModelCatalogModel } from '@opentales/sdk';

export function modelVariant(effort: string | null, fast: boolean, explicitStandard = false): string | undefined {
  return effort || fast || explicitStandard ? `ot-${effort ?? 'default'}${fast ? '-fast' : ''}` : undefined;
}

export function variantOptions(variant: unknown): { reasoningEffort: string | null; serviceTier: 'standard' | 'fast' } {
  if (typeof variant !== 'string' || !variant.startsWith('ot-')) return { reasoningEffort: null, serviceTier: 'standard' };
  const fast = variant.endsWith('-fast');
  const effort = variant.slice(3, fast ? -5 : undefined);
  return { reasoningEffort: effort === 'default' ? null : effort, serviceTier: fast ? 'fast' : 'standard' };
}

export function modelVariants(model: AiModelCatalogModel, responses: boolean) {
  return [null, ...new Set(model.reasoningEfforts ?? [])].flatMap((effort) =>
    (model.supportsFast ? [false, true] : [false]).flatMap((fast) => {
      const id = modelVariant(effort, fast, model.supportsFast);
      if (!id) return [];
      return [{ id, body: {
        ...(effort ? responses ? { reasoning: { effort } } : { reasoning_effort: effort } : {}),
        ...(model.supportsFast ? { service_tier: fast ? 'priority' : 'default' } : {})
      } }];
    })
  );
}
