import { describe, expect, it } from 'vitest';
import { clampEditorRange, markerAtOffset, type EditorAnnotationMarker } from './editor-annotations';

describe('editor annotation anchors', () => {
  it('clamps a persisted range without creating empty highlights', () => {
    expect(clampEditorRange(10, { start: -4, end: 99 })).toEqual({ start: 0, end: 10 });
    expect(clampEditorRange(10, { start: 10, end: 12 })).toBeNull();
  });

  it('chooses the narrowest overlapping annotation deterministically', () => {
    const markers: EditorAnnotationMarker[] = [
      { id: 'wide', start: 2, end: 20, kind: 'comment', status: 'open' },
      { id: 'narrow', start: 5, end: 9, kind: 'suggestion', status: 'open' }
    ];
    expect(markerAtOffset(markers, 7)?.id).toBe('narrow');
    expect(markerAtOffset(markers, 30)).toBeNull();
  });
});
