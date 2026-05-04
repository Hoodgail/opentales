import type { PrismaClient } from '@prisma/client';
import type {
  CreateProjectAiSkillInput,
  ProjectAiSkill,
  UpdateProjectAiSkillInput
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { loadBuiltInAiSkills } from './markdownCatalog.js';

const MAX_SKILLS = 50;
const MAX_CONTENT_LENGTH = 50_000;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class ProjectAiSkillsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(userId: string, projectId: string): Promise<ProjectAiSkill[]> {
    await this.access.assertProjectAccess(userId, projectId);
    const skills = await this.prisma.projectAiSkill.findMany({
      where: { projectId },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }]
    });
    const projectSkillNames = new Set(skills.map((skill) => skill.name));
    const builtIns = loadBuiltInAiSkills(projectId)
      .filter((skill) => !projectSkillNames.has(skill.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...builtIns.map(toProjectAiSkill), ...skills.map(toProjectAiSkill)];
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateProjectAiSkillInput
  ): Promise<ProjectAiSkill> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const count = await this.prisma.projectAiSkill.count({ where: { projectId } });
    if (count >= MAX_SKILLS) throw new HttpError(400, `Projects can have at most ${MAX_SKILLS} skills`);

    try {
      const skill = await this.prisma.projectAiSkill.create({
        data: {
          projectId,
          name: validateName(input.name),
          description: validateDescription(input.description),
          content: validateContent(input.content ?? defaultSkillContent(input.name, input.description)),
          enabled: input.enabled ?? true
        }
      });
      return toProjectAiSkill(skill);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new HttpError(409, 'A skill with that name already exists');
      throw error;
    }
  }

  async update(
    userId: string,
    projectId: string,
    skillId: string,
    input: UpdateProjectAiSkillInput
  ): Promise<ProjectAiSkill> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.projectAiSkill.findFirst({ where: { id: skillId, projectId } });
    if (!existing) throw new HttpError(404, 'AI skill not found');

    try {
      const skill = await this.prisma.projectAiSkill.update({
        where: { id: skillId },
        data: {
          ...(input.name !== undefined ? { name: validateName(input.name) } : {}),
          ...(input.description !== undefined ? { description: validateDescription(input.description) } : {}),
          ...(input.content !== undefined ? { content: validateContent(input.content) } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
        }
      });
      return toProjectAiSkill(skill);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new HttpError(409, 'A skill with that name already exists');
      throw error;
    }
  }

  async delete(
    userId: string,
    projectId: string,
    skillId: string
  ): Promise<{ id: string; deleted: true }> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.projectAiSkill.findFirst({ where: { id: skillId, projectId } });
    if (!existing) throw new HttpError(404, 'AI skill not found');
    await this.prisma.projectAiSkill.delete({ where: { id: skillId } });
    return { id: skillId, deleted: true };
  }
}

export function toProjectAiSkill(skill: {
  id: string;
  projectId: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ProjectAiSkill {
  return {
    id: skill.id,
    projectId: skill.projectId,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    enabled: skill.enabled,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString()
  };
}

function validateName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new HttpError(400, 'Skill name must be 1-64 lowercase letters, numbers, or hyphens');
  }
  return name;
}

function validateDescription(value: string): string {
  const description = value.trim();
  if (!description) throw new HttpError(400, 'Skill description is required');
  if (description.length > 1000) throw new HttpError(400, 'Skill description is too long');
  return description;
}

function validateContent(value: string): string {
  if (value.length > MAX_CONTENT_LENGTH) throw new HttpError(400, 'Skill content is too large');
  return value;
}

function defaultSkillContent(name: string, description: string): string {
  return `---\nname: ${validateName(name)}\ndescription: ${validateDescription(description)}\n---\n\n# ${validateName(name)}\n\nDescribe when and how the agent should use this skill.`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
