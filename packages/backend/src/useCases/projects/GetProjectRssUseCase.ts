import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http/HttpError.js';
import { env } from '../../config/env.js';

export class GetProjectRssUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(orgSlug: string, projectSlug: string): Promise<string> {
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
          orderBy: { publishedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            number: true,
            title: true,
            summary: true,
            publishedAt: true
          }
        }
      }
    });

    if (!project) {
      throw new HttpError(404, 'Project not found');
    }

    const base = env.publicBaseUrl;
    const projectUrl = `${base}/public/${orgSlug}/${projectSlug}`;
    const lastBuild = (
      project.chapters[0]?.publishedAt ?? project.publishedAt ?? new Date()
    ).toUTCString();

    const items = project.chapters
      .map((chapter) => {
        const link = `${projectUrl}#ch-${chapter.id}`;
        const pubDate = (chapter.publishedAt as Date).toUTCString();
        const title = `Chapter ${chapter.number === 0 ? 'Prologue' : chapter.number}: ${chapter.title}`;
        return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(chapter.id)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(chapter.summary ?? '')}</description>
    </item>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(project.title)}</title>
    <link>${escapeXml(projectUrl)}</link>
    <description>${escapeXml(project.description ?? '')}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <generator>OpenTales</generator>
${items}
  </channel>
</rss>
`;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
