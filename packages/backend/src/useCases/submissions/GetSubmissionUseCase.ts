import type { PrismaClient } from '@prisma/client';
import type { SubmissionDetail } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { submissionDetailInclude, toSubmissionDetail } from './submissionMapper.js';

export class GetSubmissionUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(userId: string, submissionId: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: submissionDetailInclude
    });
    if (!submission) throw new HttpError(404, 'Submission not found');
    await this.access.assertProjectAccess(userId, submission.projectId);
    return toSubmissionDetail(submission);
  }
}
