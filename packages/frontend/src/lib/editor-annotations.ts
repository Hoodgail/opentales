export interface EditorTextSelection {
  start: number;
  end: number;
  quote: string;
}

export interface EditorAnnotationMarker {
  id: string;
  start: number;
  end: number;
  kind: 'comment' | 'note' | 'suggestion';
  status: 'open' | 'resolved' | 'accepted' | 'rejected';
  label?: string;
}

/** Keep persisted anchors safe when Monaco is showing a shorter/newer body. */
export function clampEditorRange(
  valueLength: number,
  range: Pick<EditorTextSelection, 'start' | 'end'>
): Pick<EditorTextSelection, 'start' | 'end'> | null {
  const start = Math.max(0, Math.min(valueLength, Math.trunc(range.start)));
  const end = Math.max(start, Math.min(valueLength, Math.trunc(range.end)));
  return end > start ? { start, end } : null;
}

/** Prefer the narrowest marker when annotation ranges overlap. */
export function markerAtOffset(markers: EditorAnnotationMarker[], offset: number): EditorAnnotationMarker | null {
  return markers
    .filter((marker) => marker.start <= offset && offset <= marker.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start) || left.id.localeCompare(right.id))[0]
    ?? null;
}
