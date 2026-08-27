import type { RenameSymbolTarget } from '$lib/rename-symbol-ui';

export type BibleSection = 'artifacts' | 'canon' | 'entities' | 'loops' | 'timeline' | 'setups' | 'threads';
export interface BibleSelection {
  section: BibleSection;
  id: string;
}

export type OutlineProjection =
  | 'hierarchy'
  | 'corkboard'
  | 'plot-grid'
  | 'timeline'
  | 'arc'
  | 'tension';

export type BuildManuscriptSurface = 'manuscript' | 'comparison' | 'review';
export interface BuildSurfaceRequest {
  surface: BuildManuscriptSurface;
  unitId?: string;
  start?: number;
  end?: number;
  nonce: number;
}

function createStoryUiStore() {
  let bibleSelection = $state<BibleSelection | null>(null);
  let outlineProjection = $state<OutlineProjection>('hierarchy');
  let referenceRequest = $state<{ refType: string; refId: string; title: string; nonce: number } | null>(null);
  let continuousMode = $state<'write' | 'read' | 'source'>('write');
  let continuousStatus = $state<'all' | 'draft' | 'in-progress' | 'review' | 'final'>('all');
  let selectedOutlineSceneId = $state<string | null>(null);
  let buildSurfaceRequest = $state<BuildSurfaceRequest | null>(null);
  let renameSymbolRequest = $state<(RenameSymbolTarget & { nonce: number }) | null>(null);

  return {
    get bibleSelection() { return bibleSelection; },
    selectBible(next: BibleSelection | null) { bibleSelection = next; },
    get outlineProjection() { return outlineProjection; },
    setOutlineProjection(next: OutlineProjection) { outlineProjection = next; },
    get referenceRequest() { return referenceRequest; },
    requestReferences(refType: string, refId: string, title: string) {
      referenceRequest = { refType, refId, title, nonce: (referenceRequest?.nonce ?? 0) + 1 };
    },
    clearReferenceRequest() { referenceRequest = null; },
    get continuousMode() { return continuousMode; },
    setContinuousMode(next: 'write' | 'read' | 'source') { continuousMode = next; },
    get continuousStatus() { return continuousStatus; },
    setContinuousStatus(next: 'all' | 'draft' | 'in-progress' | 'review' | 'final') { continuousStatus = next; },
    get selectedOutlineSceneId() { return selectedOutlineSceneId; },
    selectOutlineScene(id: string | null) { selectedOutlineSceneId = id; },
    get buildSurfaceRequest() { return buildSurfaceRequest; },
    requestBuildSurface(
      surface: BuildManuscriptSurface,
      options: { unitId?: string; start?: number; end?: number } = {}
    ) {
      buildSurfaceRequest = {
        surface,
        ...options,
        nonce: (buildSurfaceRequest?.nonce ?? 0) + 1
      };
    },
    get renameSymbolRequest() { return renameSymbolRequest; },
    requestRenameSymbol(target: RenameSymbolTarget) {
      renameSymbolRequest = { ...target, nonce: (renameSymbolRequest?.nonce ?? 0) + 1 };
    },
    clearRenameSymbolRequest() { renameSymbolRequest = null; }
  };
}

export const storyUi = createStoryUiStore();
