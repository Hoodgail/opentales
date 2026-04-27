import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AddSubmissionCommentInput,
  SubmissionCommentAnchor,
  SubmissionDetail
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { submissionDetailInclude, toSubmissionDetail } from './submissionMapper.js';

function validateAnchor(anchor: SubmissionCommentAnchor | undefined):
  | SubmissionCommentAnchor
  | undefined {
  if (!anchor) return undefined;
  if (
    !Number.isInteger(anchor.lineStart) ||
    !Number.isInteger(anchor.lineEnd) ||
    anchor.lineStart < 1 ||
    anchor.lineEnd < anchor.lineStart
  ) {
    throw new HttpError(400, 'Anchor lineStart/lineEnd must be valid 1-indexed integers');
  }
  if (anchor.side !== 'base' && anchor.side !== 'head') {
    throw new HttpError(400, "Anchor side must be 'base' or 'head'");
  }
  return {
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
    side: anchor.side
  };
}

export class AddCommentUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    submissionId: string,
    input: AddSubmissionCommentInput
  ): Promise<SubmissionDetail> {
    const body = input.body.trim();
    if (!body) throw new HttpError(400, 'Comment body is required');
    const anchor = validateAnchor(input.anchor);

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { projectId: true }
    });
    if (!submission) throw new HttpError(404, 'Submission not found');
    await this.access.assertProjectAccess(userId, submission.projectId);

    const content: Prisma.JsonObject = anchor
      ? {
          body,
          anchor: {
            lineStart: anchor.lineStart,
            lineEnd: anchor.lineEnd,
            side: anchor.side
          }
        }
      : { body };

    await this.prisma.activity.create({
      data: {
        submissionId,
        type: 'COMMENT_ADDED',
        authorId: userId,
        content
      }
    });

    const detail = await this.prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: submissionDetailInclude
    });
    return toSubmissionDetail(detail);
  }
}
