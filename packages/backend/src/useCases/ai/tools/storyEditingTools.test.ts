import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../../http/HttpError.js';
import { buildWorkspaceTools } from './buildWorkspaceTools.js';
import { mutationToolSchemas } from './mutations.js';
import { applyContentPatch } from './shared.js';

describe('story editing tool contracts', () => {
  it('supports full replacement of an empty chapter body with a stale-safe head token', () => {
    const parsed = mutationToolSchemas.updateChapter.parse({
      chapterId: 'chapter-1',
      expectedHeadVersionId: 'version-empty',
      content: 'The first real paragraph.'
    });

    expect(parsed).toMatchObject({
      chapterId: 'chapter-1',
      expectedHeadVersionId: 'version-empty',
      content: 'The first real paragraph.'
    });
  });

  it('supports deterministic chapter compilation from revision-pinned scenes', () => {
    expect(mutationToolSchemas.compileChapterFromScenes.parse({
      chapterId: 'chapter-1',
      idempotencyKey: 'compile-chapter-1-v1',
      expectedChapterHeadVersionId: 'chapter-version-1',
      expectedSceneRevisions: { 'scene-1': 2, 'scene-2': 4 }
    })).toMatchObject({ expectedSceneRevisions: { 'scene-1': 2, 'scene-2': 4 } });
  });

  it('requires read-before-write concurrency tokens for prose changes', () => {
    expect(() => mutationToolSchemas.updateChapter.parse({
      chapterId: 'chapter-1',
      content: 'Replacement'
    })).toThrow(/expectedHeadVersionId/);

    expect(() => mutationToolSchemas.updateScene.parse({
      sceneId: 'scene-1',
      expectedRevision: 3,
      content: 'Replacement'
    })).toThrow(/expectedHeadVersionId/);
  });

  it('exposes the scene revision that the underlying use case requires', () => {
    expect(() => mutationToolSchemas.updateScene.parse({
      sceneId: 'scene-1',
      expectedHeadVersionId: 'version-1',
      content: 'Replacement'
    })).toThrow(/expectedRevision/);

    expect(mutationToolSchemas.updateScene.parse({
      sceneId: 'scene-1',
      expectedRevision: 3,
      expectedHeadVersionId: 'version-1',
      content: 'Replacement'
    })).toMatchObject({ expectedRevision: 3, expectedHeadVersionId: 'version-1' });
  });

  it('edits open submissions in place and rejects mutually exclusive body modes', () => {
    expect(mutationToolSchemas.updateSubmission.parse({
      submissionId: 'submission-1',
      expectedHeadVersionId: 'version-1',
      contentEdits: [{ oldString: 'Lio', newString: 'Neri', replaceAll: true }]
    })).toMatchObject({ submissionId: 'submission-1' });

    expect(() => mutationToolSchemas.updateSubmission.parse({
      submissionId: 'submission-1',
      expectedHeadVersionId: 'version-1',
      content: 'Full body',
      contentEdit: { oldString: 'body', newString: 'draft' }
    })).toThrow(/mutually exclusive/);

    expect(() => mutationToolSchemas.mergeSubmission.parse({
      submissionId: 'submission-1',
      expectedMainHeadVersionId: 'main-version-2',
      confirm: false
    })).toThrow();
    expect(mutationToolSchemas.mergeSubmission.parse({
      submissionId: 'submission-1',
      expectedMainHeadVersionId: 'main-version-2',
      confirm: true
    })).toMatchObject({ confirm: true });
  });

  it('applies ordered exact edits and supports explicit empty replacements', () => {
    expect(applyContentPatch('', { mode: 'replace', content: 'Draft' })).toBe('Draft');
    expect(applyContentPatch('Lio entered Vale. Lio left.', {
      mode: 'edit',
      edits: [
        { oldString: 'Lio', newString: 'Neri', replaceAll: true },
        { oldString: 'Vale', newString: 'the civic vault' }
      ]
    })).toBe('Neri entered the civic vault. Neri left.');
  });

  it('fails safely when an exact edit is missing or ambiguous', () => {
    expect(() => applyContentPatch('same same', {
      mode: 'edit',
      edits: [{ oldString: 'same', newString: 'different' }]
    })).toThrowError(HttpError);
    expect(() => applyContentPatch('same same', {
      mode: 'edit',
      edits: [{ oldString: 'missing', newString: 'different' }]
    })).toThrow(/re-read the target/);
  });

  it('accepts atomic mixed-target patches with scene-specific revision guards', () => {
    expect(mutationToolSchemas.applyStoryPatch.parse({
      idempotencyKey: 'repair-continuity-v1',
      operations: [
        {
          target: 'submission',
          id: 'submission-10',
          expectedHeadVersionId: 'version-10',
          patch: { mode: 'edit', edits: [{ oldString: 'Lio', newString: 'Neri' }] }
        },
        {
          target: 'scene',
          id: 'scene-28',
          expectedHeadVersionId: 'version-28',
          expectedRevision: 4,
          patch: { mode: 'replace', content: '' }
        }
      ]
    }).operations).toHaveLength(2);
  });

  it('exposes a complete user-facing build edit, compile, and review lifecycle', () => {
    const tools = buildWorkspaceTools(
      {} as PrismaClient,
      { userId: 'owner-1', projectId: 'project-1' },
      { handleApproval: async (_name, _input, execute) => execute() }
    ) as Record<string, { inputSchema?: { parse(value: unknown): unknown } }>;
    expect(Object.keys(tools)).toEqual(expect.arrayContaining([
      'authorizeNovelBuild',
      'createBuildUnit',
      'updateBuildUnit',
      'invalidateBuildUnit',
      'compileBuild',
      'createBuildReview',
      'approveBuildReview',
      'mergeBuildReview',
      'rejectBuildReview'
    ]));
    expect(tools.updateBuildUnit.inputSchema?.parse({
      buildRunId: 'build-1',
      unitId: 'unit-1',
      idempotencyKey: 'unit-edit-v1',
      expectedBuildRevision: 8,
      expectedUnitRevision: 3,
      expectedHeadVersionId: 'version-3',
      patch: { mode: 'edit', edits: [{ oldString: 'Lio', newString: 'Neri' }] },
      status: 'accepted'
    })).toBeTruthy();
    expect(() => tools.mergeBuildReview.inputSchema?.parse({
      buildRunId: 'build-1',
      reviewId: 'review-1',
      idempotencyKey: 'merge-v1',
      expectedRevision: 1,
      confirm: false
    })).toThrow();
  });
});
