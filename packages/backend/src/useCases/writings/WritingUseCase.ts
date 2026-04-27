import { Prisma, type WritingKind } from '@prisma/client';
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
    }
  ) {
    const writing = await tx.writing.findUniqueOrThrow({
      where: { id: input.writingId },
      include: { defaultBranch: true }
    });

    if (!writing.defaultBranch) {
      throw new Error(`Writing ${input.writingId} has no default branch`);
    }

    const version = await tx.writingVersion.create({
      data: {
        branchId: writing.defaultBranch.id,
        parentVersionId: writing.defaultBranch.headVersionId,
        body: input.body,
        wordCount: countWords(input.body),
        authorId: input.authorId,
        message: input.message ?? 'Update body'
      }
    });

    await tx.writingBranch.update({
      where: { id: writing.defaultBranch.id },
      data: { headVersionId: version.id }
    });

    return version;
  }
}
