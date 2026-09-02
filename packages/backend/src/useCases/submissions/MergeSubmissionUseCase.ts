import type { PrismaClient } from '@prisma/client';
import type { MergeSubmissionInput, SubmissionDetail } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { submissionDetailInclude, toSubmissionDetail } from './submissionMapper.js';

export class MergeSubmissionUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, submissionId: string, input: MergeSubmissionInput = {}): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, projectId: true, status: true, kind: true }
    });
    if (!submission) throw new HttpError(404, 'Submission not found');
    if (submission.status !== 'OPEN') {
      throw new HttpError(409, `Submission is already ${submission.status.toLowerCase()}`);
    }

    // Merging changes the canonical text — requires write permission.
    await this.access.assertPermission(userId, submission.projectId, 'project:write');

    const merged = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
      const full = await tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: {
          branch: { include: { headVersion: true } }
        }
      });
      if (full.status !== 'OPEN') throw new HttpError(409, `Submission is already ${full.status.toLowerCase()}`);

      const proposedBody = full.branch.headVersion?.body ?? '';

      if (full.kind === 'CHAPTER_EDIT') {
        if (!full.chapterId) throw new HttpError(500, 'Chapter edit missing chapterId');

        const chapter = await tx.chapter.findUniqueOrThrow({
          where: { id: full.chapterId },
          include: { bodyWriting: { include: { defaultBranch: true } } }
        });
        const defaultBranch = chapter.bodyWriting.defaultBranch;
        if (!defaultBranch) throw new HttpError(500, 'Chapter has no default branch');
        await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${defaultBranch.id} FOR UPDATE`;
        const lockedBranch = await tx.writingBranch.findUniqueOrThrow({ where: { id: defaultBranch.id } });
        const expectedHeadVersionId = input.expectedMainHeadVersionId !== undefined
          ? input.expectedMainHeadVersionId
          : full.baseVersionId;
        if (lockedBranch.headVersionId !== expectedHeadVersionId) {
          throw new HttpError(409, 'Canonical chapter changed after the submission snapshot; read the current chapter, reconcile the proposal, and retry with its headVersionId', {
            expectedMainHeadVersionId: expectedHeadVersionId,
            actualMainHeadVersionId: lockedBranch.headVersionId,
            submissionBaseVersionId: full.baseVersionId
          });
        }
        if (input.expectedMainHeadVersionId !== undefined && input.expectedMainHeadVersionId !== full.baseVersionId && input.confirm !== true) {
          throw new HttpError(400, 'confirm=true is required to merge a reconciled proposal against a canonical head newer than its original base');
        }

        const newVersion = await tx.writingVersion.create({
          data: {
            branchId: defaultBranch.id,
            parentVersionId: lockedBranch.headVersionId,
            body: proposedBody,
            wordCount: countWords(proposedBody),
            authorId: userId,
            message: `Merge submission ${full.id}`
          }
        });

        const updated = await tx.writingBranch.updateMany({
          where: { id: defaultBranch.id, headVersionId: lockedBranch.headVersionId },
          data: { headVersionId: newVersion.id }
        });
        if (updated.count !== 1) throw new HttpError(409, 'Canonical chapter changed concurrently; read it and retry');
      } else {
        // NEW_CHAPTER — materialize a real Chapter pointing at the submission's Writing.
        if (!full.proposedTitle) throw new HttpError(500, 'New chapter missing proposedTitle');

        const writingId = full.branch.writingId;

        // Promote the submission branch to be the new writing's default branch.
        await tx.writing.update({
          where: { id: writingId },
          data: { defaultBranchId: full.branch.id }
        });

        // Always append — chapter number is `(max number) + 1` to avoid
        // unique-constraint shuffling. Reordering can be done after merge.
        const last = await tx.chapter.findFirst({
          where: { projectId: full.projectId },
          orderBy: { number: 'desc' },
          select: { number: true }
        });
        const number = (last?.number ?? 0) + 1;

        // Compute order — append to the act if any, else top-level.
        const lastInAct = await tx.chapter.findFirst({
          where: { projectId: full.projectId, actId: full.proposedActId ?? null },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const order = (lastInAct?.order ?? -1) + 1;

        await tx.chapter.create({
          data: {
            projectId: full.projectId,
            actId: full.proposedActId ?? null,
            number,
            title: full.proposedTitle,
            bodyWritingId: writingId,
            order
          }
        });
      }

      const updated = await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: 'MERGED',
          decidedAt: new Date(),
          decidedById: userId
        },
        include: submissionDetailInclude
      });

      await tx.activity.create({
        data: {
          submissionId,
          type: 'SUBMISSION_MERGED',
          authorId: userId
        }
      });

      return updated;
    });

    return toSubmissionDetail(merged);
  }
}
