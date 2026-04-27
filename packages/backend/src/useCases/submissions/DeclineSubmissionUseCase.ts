import type { PrismaClient } from '@prisma/client';
import type { SubmissionDetail } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { submissionDetailInclude, toSubmissionDetail } from './submissionMapper.js';

export class DeclineSubmissionUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, submissionId: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, projectId: true, status: true }
    });
    if (!submission) throw new HttpError(404, 'Submission not found');
    if (submission.status !== 'OPEN') {
      throw new HttpError(409, `Submission is already ${submission.status.toLowerCase()}`);
    }
    await this.access.assertPermission(userId, submission.projectId, 'project:write');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'DECLINED', decidedAt: new Date(), decidedById: userId },
        include: submissionDetailInclude
      });
      await tx.activity.create({
        data: { submissionId, type: 'SUBMISSION_DECLINED', authorId: userId }
      });
      return next;
    });

    return toSubmissionDetail(updated);
  }
}
