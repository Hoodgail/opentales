import type { CoverOrientation, PrismaClient, ProjectVisibility } from '@prisma/client';
import type { ProjectSummary, UpdateProjectInput } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { toSlug } from '../../utils/slug.js';
import { fromCoverOrientation, fromProjectVisibility, toProjectSummary } from './projectMapper.js';

export class UpdateProjectUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    input: UpdateProjectInput
  ): Promise<ProjectSummary> {
    await this.access.assertPermission(userId, projectId, 'project:write');

    const data: {
      title?: string;
      description?: string | null;
      slug?: string;
      genre?: string | null;
      perspective?: string | null;
      pov?: string | null;
      voice?: string | null;
      tone?: string | null;
      themes?: string[];
      visibility?: ProjectVisibility;
      coverAssetId?: string | null;
      coverOrientation?: CoverOrientation;
      publishedAt?: Date | null;
    } = {};

    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed) throw new HttpError(400, 'Project title cannot be empty');
      data.title = trimmed;
    }

    if (input.slug !== undefined) {
      const slug = toSlug(input.slug);
      if (!slug) throw new HttpError(400, 'Project slug is invalid');
      const orgId = await this.access.getProjectOrgId(projectId);
      const conflict = await this.prisma.project.findFirst({
        where: { orgId, slug, NOT: { id: projectId } },
        select: { id: true }
      });
      if (conflict) {
        throw new HttpError(409, 'Another project in this workspace already uses that slug');
      }
      data.slug = slug;
    }

    if (input.description !== undefined) data.description = input.description;
    if (input.genre !== undefined) data.genre = input.genre;
    if (input.perspective !== undefined) data.perspective = input.perspective;
    if (input.pov !== undefined) data.pov = input.pov;
    if (input.voice !== undefined) data.voice = input.voice;
    if (input.tone !== undefined) data.tone = input.tone;
    if (input.themes !== undefined) data.themes = input.themes;
    if (input.coverOrientation !== undefined)
      data.coverOrientation = fromCoverOrientation(input.coverOrientation);
    if (input.coverAssetId !== undefined) data.coverAssetId = input.coverAssetId;
    if (input.visibility !== undefined) {
      const next = fromProjectVisibility(input.visibility);
      data.visibility = next;
      // Track project-level publish moment for /read SEO + sort
      data.publishedAt = next === 'PUBLIC' ? new Date() : null;
    }

    const project = await this.prisma.project.update({
      where: { id: projectId },
      data,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        genre: true,
        updatedAt: true,
        visibility: true,
        coverAssetId: true,
        coverOrientation: true
      }
    });

    return toProjectSummary(project);
  }
}
