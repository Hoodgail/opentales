import type { Prisma } from '@prisma/client';
import { stableHash } from './schemas.js';

type CanonReader = Pick<Prisma.TransactionClient, 'buildManuscriptUnit' | 'canonFact' | 'entityState' | 'timelineEvent' | 'openLoop' | 'setupPayoffLink' | 'plotThread' | 'buildTask' | 'buildTrace'>;

export interface CanonSnapshot {
  version: 1;
  unitHeads: Record<string, string>;
  unitStateHash: string;
  ledgerHash: string;
}

export interface CanonReuse {
  sourceTaskId: string;
  sourceTraceId: string;
}

/** Fingerprint source identity, chronology and actual ledger values, not just timestamps. */
export async function captureCanonSnapshot(db: CanonReader, buildRunId: string, unitIds: string[]): Promise<CanonSnapshot | null> {
  if (!unitIds.length || new Set(unitIds).size !== unitIds.length) return null;
  const units = await db.buildManuscriptUnit.findMany({
    where: { id: { in: unitIds }, buildRunId, kind: 'SCENE', invalidatedAt: null },
    select: {
      id: true, order: true, parentUnitId: true, planArtifactId: true, povCharacterId: true, locationId: true,
      storyDate: true, storyTime: true, metadata: true, parentUnit: { select: { order: true } },
      branch: { select: { headVersionId: true } }
    }, orderBy: { id: 'asc' }
  });
  if (units.length !== unitIds.length || units.some(unit => !unit.branch.headVersionId)) return null;
  const query = { where: { buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: { id: 'asc' as const } };
  const ledger = await Promise.all([
    db.canonFact.findMany(query), db.entityState.findMany(query), db.timelineEvent.findMany(query),
    db.openLoop.findMany(query), db.setupPayoffLink.findMany(query), db.plotThread.findMany(query)
  ]);
  return {
    version: 1,
    unitHeads: Object.fromEntries(units.map(unit => [unit.id, unit.branch.headVersionId!])),
    unitStateHash: stableHash(units),
    ledgerHash: stableHash(JSON.parse(JSON.stringify(ledger)))
  };
}

/** Conservative reuse: unknown provenance, changed prose or any ledger change means fresh extraction. */
export async function validateCanonReuse(db: CanonReader, buildRunId: string, unitIds: string[], reuse: CanonReuse): Promise<boolean> {
  const source = await db.buildTask.findFirst({ where: { id: reuse.sourceTaskId, buildRunId, type: 'extract-scene-canon', status: 'DONE' } });
  if (!source || source.scopeUnitIds.length !== unitIds.length || source.scopeUnitIds.some(id => !unitIds.includes(id))) return false;
  const trace = await db.buildTrace.findFirst({
    where: { id: reuse.sourceTraceId, buildRunId, taskId: source.id, status: 'COMPLETED', attempt: source.attempts }
  });
  if (!trace || !trace.outputs || typeof trace.outputs !== 'object' || Array.isArray(trace.outputs)) return false;
  const snapshot = trace.outputs.canonSnapshot;
  const current = await captureCanonSnapshot(db, buildRunId, unitIds);
  return Boolean(current && snapshot && stableHash(snapshot) === stableHash(current));
}
