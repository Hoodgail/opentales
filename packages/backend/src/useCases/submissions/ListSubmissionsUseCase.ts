import type { PrismaClient, SubmissionStatus } from '@prisma/client';
import type { SubmissionStatus as SdkStatus, SubmissionSummary } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { submissionInclude, toStatus, toSubmissionSummary } from './submissionMapper.js';

export class ListSubmissionsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    filter?: { status?: SdkStatus }
  ): Promise<SubmissionSummary[]> {
    await this.access.assertProjectAccess(userId, projectId);

    const status: SubmissionStatus | undefined = filter?.status ? toStatus(filter.status) : undefined;

    const submissions = await this.prisma.submission.findMany({
      where: { projectId, status },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: submissionInclude
    });

    return submissions.map(toSubmissionSummary);
  }
}
