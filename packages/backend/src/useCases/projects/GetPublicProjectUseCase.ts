import type { PrismaClient } from '@prisma/client';
import type { PublicChapter, PublicProject } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { env } from '../../config/env.js';
import { toCoverOrientation } from './projectMapper.js';

export class GetPublicProjectUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(orgSlug: string, projectSlug: string): Promise<PublicProject> {
    const project = await this.prisma.project.findFirst({
      where: {
        slug: projectSlug,
        archivedAt: null,
        deletedAt: null,
        visibility: 'PUBLIC',
        org: { slug: orgSlug }
      },
      include: {
        org: { select: { slug: true, name: true } },
        chapters: {
          where: { publishedAt: { not: null }, deletedAt: null },
          orderBy: [{ number: 'asc' }],
          include: {
            bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        }
      }
    });

    if (!project) {
      throw new HttpError(404, 'Project not found');
    }

    const chapters: PublicChapter[] = project.chapters.map((chapter) => {
      const head = chapter.bodyWriting.defaultBranch?.headVersion;
      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary ?? '',
        wordCount: head?.wordCount ?? 0,
        content: head?.body ?? '',
        publishedAt: (chapter.publishedAt as Date).toISOString()
      };
    });

    return {
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description ?? '',
      genre: project.genre ?? '',
      orgSlug: project.org.slug,
      orgName: project.org.name,
      coverUrl: project.coverAssetId ? `${env.publicBaseUrl}/assets/${project.coverAssetId}` : null,
      coverOrientation: toCoverOrientation(project.coverOrientation),
      publishedAt: project.publishedAt ? project.publishedAt.toISOString() : null,
      chapters
    };
  }
}
