import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EvidenceLinks from './EvidenceLinks.svelte';

afterEach(() => cleanup());

describe('EvidenceLinks', () => {
  it('renders chapter, scene, artifact, and source-span-only evidence without declaration-order crashes', () => {
    render(EvidenceLinks, {
      evidence: [
        { id: 'chapter', chapterId: 'chapter-1', title: 'Chapter evidence', excerpt: 'A chapter quote.' },
        { id: 'scene', sceneId: 'scene-1', title: 'Scene evidence', excerpt: 'A scene quote.' },
        { id: 'artifact', artifactId: 'artifact-1', title: 'Artifact evidence' },
        { id: 'span', title: 'Span evidence', sourceSpan: { chapterId: 'chapter-2', start: 4, end: 9, quote: 'A ranged quote.' } }
      ]
    });

    expect(screen.getByText('Chapter evidence')).toBeTruthy();
    expect(screen.getByText('Scene evidence')).toBeTruthy();
    expect(screen.getByText('Artifact evidence')).toBeTruthy();
    expect(screen.getByText('Span evidence')).toBeTruthy();
  });

  it('routes build-unit, artifact, and generic reference evidence to their exact handlers', async () => {
    const onUnit = vi.fn();
    const onArtifact = vi.fn();
    const onReference = vi.fn();
    render(EvidenceLinks, {
      evidence: [
        { id: 'unit', title: 'Branch range', sourceSpan: { unitId: 'unit-1', start: 12, end: 24 } },
        { id: 'artifact', title: 'Artifact record', artifactId: 'artifact-1' },
        { id: 'state', title: 'Canon record', refType: 'canon-fact', refId: 'fact-1' }
      ],
      onUnit,
      onArtifact,
      onReference
    });

    await fireEvent.click(screen.getByRole('button', { name: /Branch range/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Artifact record/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Canon record/ }));

    expect(onUnit).toHaveBeenCalledWith('unit-1', { start: 12, end: 24 });
    expect(onArtifact).toHaveBeenCalledWith('artifact-1');
    expect(onReference).toHaveBeenCalledWith('canon-fact', 'fact-1');
  });
});
