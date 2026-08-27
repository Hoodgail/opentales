import type { NamedSnapshot, NamedSnapshotComparison, WritingAnnotationThread } from '@opentales/sdk';
import type { EditorAnnotationMarker } from './editor-annotations';

export function currentHeadsFromComparison(comparison: NamedSnapshotComparison | null): Record<string, string | null> {
  if (!comparison || comparison.rightSnapshotId !== null) return {};
  return Object.fromEntries(comparison.prose.map((item) => [item.writingId, item.rightVersionId]));
}

export function snapshotTarget(snapshot: NamedSnapshot): string {
  if (snapshot.scope === 'project') return 'Whole project';
  const target = snapshot.chapterId ?? snapshot.sceneId ?? snapshot.projectDocId ?? snapshot.writingId
    ?? snapshot.checkpointId ?? snapshot.compilationId ?? snapshot.buildRunId;
  return target ? `${snapshot.scope} · ${target}` : snapshot.scope;
}

export function annotationMarkers(threads: WritingAnnotationThread[]): EditorAnnotationMarker[] {
  return threads.map((thread) => ({
    id: thread.id,
    start: thread.start,
    end: thread.end,
    kind: thread.kind,
    status: thread.status,
    label: `${thread.kind}: ${thread.body}`
  }));
}
