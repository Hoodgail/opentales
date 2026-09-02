import type { Prisma, PrismaClient } from '@prisma/client';
import type { SubmissionDetail, UpdateSubmissionInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { countWords } from '../../utils/wordCount.js';
import { submissionDetailInclude, toSubmissionDetail } from './submissionMapper.js';

export class UpdateSubmissionUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    submissionId: string,
    input: UpdateSubmissionInput
  ): Promise<SubmissionDetail> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (input.body !== undefined && input.body.length > 2_000_000) {
      throw new HttpError(400, 'Submission body must be no larger than 2 MB');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} AND "projectId" = ${projectId} FOR UPDATE`;
      const submission = await tx.submission.findFirst({
        where: { id: submissionId, projectId },
        include: { branch: true }
      });
      if (!submission) throw new HttpError(404, 'Submission not found');
      if (submission.status !== 'OPEN') {
        throw new HttpError(409, `Only an open submission can be edited; this submission is ${submission.status.toLowerCase()}`);
      }

      await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${submission.branchId} FOR UPDATE`;
      const branch = await tx.writingBranch.findUniqueOrThrow({ where: { id: submission.branchId } });
      if (branch.headVersionId !== input.expectedHeadVersionId) {
        throw new HttpError(409, 'Submission head is stale; call readSubmission and retry with its headVersionId', {
          expectedHeadVersionId: input.expectedHeadVersionId,
          actualHeadVersionId: branch.headVersionId
        });
      }

      const data: Prisma.SubmissionUpdateInput = {};
      const changedFields: string[] = [];
      if (input.title !== undefined) {
        data.title = requiredText(input.title, 'Submission title');
        changedFields.push('title');
      }
      if (input.message !== undefined) {
        data.message = input.message?.trim() || null;
        changedFields.push('message');
      }
      if (input.proposedTitle !== undefined || input.proposedNumber !== undefined || input.proposedActId !== undefined) {
        if (submission.kind !== 'NEW_CHAPTER') {
          throw new HttpError(400, 'proposedTitle, proposedNumber, and proposedActId apply only to new-chapter submissions');
        }
        if (input.proposedTitle !== undefined) {
          data.proposedTitle = requiredText(input.proposedTitle, 'Proposed chapter title');
          changedFields.push('proposedTitle');
        }
        if (input.proposedNumber !== undefined) {
          if (input.proposedNumber !== null && (!Number.isInteger(input.proposedNumber) || input.proposedNumber < 1)) {
            throw new HttpError(400, 'proposedNumber must be a positive integer or null');
          }
          data.proposedNumber = input.proposedNumber;
          changedFields.push('proposedNumber');
        }
        if (input.proposedActId !== undefined) {
          if (input.proposedActId) {
            const act = await tx.act.findFirst({ where: { id: input.proposedActId, projectId }, select: { id: true } });
            if (!act) throw new HttpError(400, 'proposedActId does not belong to this project');
          }
          data.proposedActId = input.proposedActId;
          changedFields.push('proposedActId');
        }
      }

      let nextHeadVersionId = branch.headVersionId;
      if (input.body !== undefined) {
        const current = branch.headVersionId
          ? await tx.writingVersion.findUnique({ where: { id: branch.headVersionId }, select: { body: true } })
          : null;
        if ((current?.body ?? '') !== input.body) {
          const version = await tx.writingVersion.create({
            data: {
              branchId: branch.id,
              parentVersionId: branch.headVersionId,
              body: input.body,
              wordCount: countWords(input.body),
              authorId: userId,
              message: 'Update open submission'
            }
          });
          const updated = await tx.writingBranch.updateMany({
            where: { id: branch.id, headVersionId: branch.headVersionId },
            data: { headVersionId: version.id }
          });
          if (updated.count !== 1) throw new HttpError(409, 'Submission head changed concurrently; call readSubmission and retry');
          nextHeadVersionId = version.id;
        }
        changedFields.push('body');
      }

      if (!changedFields.length) throw new HttpError(400, 'At least one submission field or body change is required');
      await tx.submission.update({ where: { id: submission.id }, data });
      await tx.activity.create({
        data: {
          submissionId: submission.id,
          type: 'SUBMISSION_UPDATED',
          authorId: userId,
          content: { changedFields, headVersionId: nextHeadVersionId }
        }
      });
    });

    const updated = await this.prisma.submission.findFirst({
      where: { id: submissionId, projectId },
      include: submissionDetailInclude
    });
    if (!updated) throw new HttpError(404, 'Submission not found');
    return toSubmissionDetail(updated);
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new HttpError(400, `${label} is required`);
  if (normalized.length > 20_000) throw new HttpError(400, `${label} is too long`);
  return normalized;
}
