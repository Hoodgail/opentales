import { Prisma, type WritingKind } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { countWords } from '../../utils/wordCount.js';

type Tx = Prisma.TransactionClient;

export class WritingUseCase {
  async createWriting(
    tx: Tx,
    input: {
      projectId: string;
      kind: WritingKind;
      body?: string;
      authorId?: string;
      message?: string;
    }
  ): Promise<string> {
    const writing = await tx.writing.create({
      data: {
        projectId: input.projectId,
        kind: input.kind
      }
    });

    const branch = await tx.writingBranch.create({
      data: {
        writingId: writing.id,
        name: 'main'
      }
    });

    const version = await tx.writingVersion.create({
      data: {
        branchId: branch.id,
        body: input.body ?? '',
        wordCount: countWords(input.body ?? ''),
        authorId: input.authorId,
        message: input.message ?? 'Initial version'
      }
    });

    await tx.writingBranch.update({
      where: { id: branch.id },
      data: { headVersionId: version.id }
    });

    await tx.writing.update({
      where: { id: writing.id },
      data: { defaultBranchId: branch.id }
    });

    return writing.id;
  }

  async updateDefaultBranch(
    tx: Tx,
    input: {
      writingId: string;
      body: string;
      authorId?: string;
      message?: string;
      expectedHeadVersionId?: string | null;
    }
  ) {
    const writing = await tx.writing.findUniqueOrThrow({
      where: { id: input.writingId },
      include: { defaultBranch: true }
    });

    if (!writing.defaultBranch) {
      throw new Error(`Writing ${input.writingId} has no default branch`);
    }

    await tx.$queryRaw`SELECT id FROM "WritingBranch" WHERE id = ${writing.defaultBranch.id} FOR UPDATE`;
    const branch = await tx.writingBranch.findUniqueOrThrow({
      where: { id: writing.defaultBranch.id }
    });
    if (
      input.expectedHeadVersionId !== undefined &&
      branch.headVersionId !== input.expectedHeadVersionId
    ) {
      throw new HttpError(409, 'Writing head is stale; re-read the target before editing', {
        expectedHeadVersionId: input.expectedHeadVersionId,
        actualHeadVersionId: branch.headVersionId
      });
    }

    const version = await tx.writingVersion.create({
      data: {
        branchId: branch.id,
        parentVersionId: branch.headVersionId,
        body: input.body,
        wordCount: countWords(input.body),
        authorId: input.authorId,
        message: input.message ?? 'Update body'
      }
    });

    const updated = await tx.writingBranch.updateMany({
      where: { id: branch.id, headVersionId: branch.headVersionId },
      data: { headVersionId: version.id }
    });
    if (updated.count !== 1) {
      throw new HttpError(409, 'Writing head changed concurrently; re-read the target and retry');
    }

    return version;
  }
}
