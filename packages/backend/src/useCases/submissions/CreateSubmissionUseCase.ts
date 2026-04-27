import type { PrismaClient, WritingKind } from '@prisma/client';
import type { CreateSubmissionInput, SubmissionSummary } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import {
  fromSdkKind,
  submissionInclude,
  toSubmissionSummary
} from './submissionMapper.js';

/**
 * Creates a draft submission. The proposed body is stored on a fresh
 * WritingBranch off the entity's current default-branch head — so the diff
 * remains stable against the snapshot taken at submit-time, even if the
 * default branch keeps moving.
 *
 * For CHAPTER_EDIT: branch is created on the chapter's body Writing.
 * For NEW_CHAPTER: a placeholder Writing of kind CHAPTER_BODY is created
 * with a single branch holding the proposed body. The merge step turns it
 * into a real Chapter row.
 */
export class CreateSubmissionUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: CreateSubmissionInput
  ): Promise<SubmissionSummary> {
    // Any project member can submit (VIEWERs included — they're proposing, not writing).
    await this.access.assertProjectAccess(userId, projectId);

    const title = input.title.trim();
    if (!title) throw new HttpError(400, 'Submission title is required');

    const kind = fromSdkKind(input.kind);
    const body = input.body ?? '';

    if (kind === 'CHAPTER_EDIT' && !input.chapterId) {
      throw new HttpError(400, 'chapterId is required for chapter-edit submissions');
    }
    if (kind === 'NEW_CHAPTER' && !input.proposedTitle?.trim()) {
      throw new HttpError(400, 'proposedTitle is required for new-chapter submissions');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let writingId: string;
      let baseVersionId: string | null = null;

      if (kind === 'CHAPTER_EDIT') {
        const chapter = await tx.chapter.findFirst({
          where: { id: input.chapterId!, projectId },
          select: { bodyWritingId: true }
        });
        if (!chapter) throw new HttpError(404, 'Chapter not found');
        writingId = chapter.bodyWritingId;

        const writing = await tx.writing.findUniqueOrThrow({
          where: { id: writingId },
          include: { defaultBranch: { select: { headVersionId: true } } }
        });
        baseVersionId = writing.defaultBranch?.headVersionId ?? null;
      } else {
        // Create a brand-new Writing for the proposed chapter.
        const writing = await tx.writing.create({
          data: { projectId, kind: 'CHAPTER_BODY' as WritingKind }
        });
        writingId = writing.id;
      }

      // Create a draft branch unique to this submission.
      const branch = await tx.writingBranch.create({
        data: {
          writingId,
          name: `submission-${Date.now()}`,
          parentBranchId: null
        }
      });

      const headVersion = await tx.writingVersion.create({
        data: {
          branchId: branch.id,
          parentVersionId: baseVersionId,
          body,
          wordCount: countWords(body),
          authorId: userId,
          message: kind === 'CHAPTER_EDIT' ? 'Proposed edit' : 'Proposed new chapter'
        }
      });

      await tx.writingBranch.update({
        where: { id: branch.id },
        data: { headVersionId: headVersion.id }
      });

      const submission = await tx.submission.create({
        data: {
          projectId,
          authorId: userId,
          kind,
          title,
          message: input.message ?? null,
          chapterId: kind === 'CHAPTER_EDIT' ? input.chapterId! : null,
          branchId: branch.id,
          baseVersionId,
          proposedTitle: kind === 'NEW_CHAPTER' ? input.proposedTitle!.trim() : null,
          proposedNumber: kind === 'NEW_CHAPTER' ? input.proposedNumber ?? null : null,
          proposedActId: kind === 'NEW_CHAPTER' ? input.proposedActId ?? null : null
        },
        include: submissionInclude
      });

      await tx.activity.create({
        data: {
          submissionId: submission.id,
          type: 'SUBMISSION_OPENED',
          authorId: userId
        }
      });

      return submission;
    });

    return toSubmissionSummary(created);
  }
}
