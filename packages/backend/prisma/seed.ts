import { PrismaClient, type ChapterStatus, type ObstacleType, type WritingKind } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  initialActs,
  initialChapters,
  initialCharacters,
  initialLocations,
  initialStructure
} from '../../frontend/src/lib/data/manuscript-data.ts';
import { countWords } from '../src/utils/wordCount.js';

const prisma = new PrismaClient();

async function createWriting(input: {
  projectId: string;
  kind: WritingKind;
  body: string;
  authorId: string;
}): Promise<string> {
  const writing = await prisma.writing.create({
    data: { projectId: input.projectId, kind: input.kind }
  });
  const branch = await prisma.writingBranch.create({
    data: { writingId: writing.id, name: 'main' }
  });
  const version = await prisma.writingVersion.create({
    data: {
      branchId: branch.id,
      body: input.body,
      wordCount: countWords(input.body),
      authorId: input.authorId,
      message: 'Seed version'
    }
  });
  await prisma.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
  await prisma.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } });
  return writing.id;
}

const chapterStatusMap: Record<string, ChapterStatus> = {
  draft: 'DRAFT',
  'in-progress': 'IN_PROGRESS',
  review: 'REVIEW',
  final: 'FINAL'
};

const obstacleTypeMap: Record<string, ObstacleType> = {
  internal: 'INTERNAL',
  external: 'EXTERNAL',
  interpersonal: 'INTERPERSONAL'
};

async function main() {
  const email = 'demo@opentales.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Seed skipped: demo user already exists');
    return;
  }

  const user = await prisma.user.create({
    data: {
      username: 'demo',
      email,
      name: 'Demo Writer',
      passwordHash: await bcrypt.hash('password123', 12)
    }
  });

  const org = await prisma.org.create({
    data: {
      slug: 'demo-workspace',
      name: 'Demo Workspace',
      memberships: {
        create: {
          userId: user.id,
          role: 'OWNER'
        }
      }
    }
  });

  const project = await prisma.project.create({
    data: {
      orgId: org.id,
      slug: 'blackwood-cipher',
      title: initialStructure.title,
      genre: initialStructure.genre,
      perspective: initialStructure.perspective,
      pov: initialStructure.pov,
      voice: initialStructure.voice,
      tone: initialStructure.tone,
      themes: initialStructure.themes
    }
  });

  const loglineWritingId = await createWriting({
    projectId: project.id,
    kind: 'LOGLINE',
    body: initialStructure.logline,
    authorId: user.id
  });
  const outlineWritingId = await createWriting({
    projectId: project.id,
    kind: 'OUTLINE',
    body: initialStructure.outline,
    authorId: user.id
  });
  const climaxWritingId = await createWriting({
    projectId: project.id,
    kind: 'CLIMAX',
    body: initialStructure.climax,
    authorId: user.id
  });

  await prisma.storyStructure.create({
    data: { projectId: project.id, loglineWritingId, outlineWritingId, climaxWritingId }
  });

  for (const [index, obstacle] of initialStructure.obstacles.entries()) {
    const descriptionWritingId = await createWriting({
      projectId: project.id,
      kind: 'OBSTACLE_DESCRIPTION',
      body: obstacle.description,
      authorId: user.id
    });
    const resolutionWritingId = await createWriting({
      projectId: project.id,
      kind: 'OBSTACLE_RESOLUTION',
      body: obstacle.resolution,
      authorId: user.id
    });
    await prisma.obstacle.create({
      data: {
        id: obstacle.id,
        projectId: project.id,
        title: obstacle.title,
        type: obstacleTypeMap[obstacle.type],
        descriptionWritingId,
        resolutionWritingId,
        order: index
      }
    });
  }

  for (const character of initialCharacters) {
    const descriptionWritingId = await createWriting({
      projectId: project.id,
      kind: 'CHARACTER_DESCRIPTION',
      body: character.description,
      authorId: user.id
    });
    const appearanceWritingId = await createWriting({
      projectId: project.id,
      kind: 'CHARACTER_APPEARANCE',
      body: character.appearance,
      authorId: user.id
    });
    const motivationWritingId = await createWriting({
      projectId: project.id,
      kind: 'CHARACTER_MOTIVATION',
      body: character.motivation,
      authorId: user.id
    });
    const arcWritingId = await createWriting({
      projectId: project.id,
      kind: 'CHARACTER_ARC',
      body: character.arc,
      authorId: user.id
    });

    await prisma.character.create({
      data: {
        id: character.id,
        projectId: project.id,
        name: character.name,
        role: character.role,
        age: character.age,
        occupation: character.occupation,
        traits: character.traits,
        descriptionWritingId,
        appearanceWritingId,
        motivationWritingId,
        arcWritingId
      }
    });
  }

  for (const character of initialCharacters) {
    for (const relationship of character.relationships) {
      await prisma.characterRelationship.create({
        data: {
          projectId: project.id,
          fromCharacterId: character.id,
          toCharacterId: relationship.characterId,
          type: relationship.type,
          note: relationship.note
        }
      });
    }
  }

  for (const location of initialLocations) {
    const descriptionWritingId = await createWriting({
      projectId: project.id,
      kind: 'LOCATION_DESCRIPTION',
      body: location.description,
      authorId: user.id
    });
    const atmosphereWritingId = await createWriting({
      projectId: project.id,
      kind: 'LOCATION_ATMOSPHERE',
      body: location.atmosphere,
      authorId: user.id
    });
    const significanceWritingId = await createWriting({
      projectId: project.id,
      kind: 'LOCATION_SIGNIFICANCE',
      body: location.significance,
      authorId: user.id
    });
    const sensoryWritingId = await createWriting({
      projectId: project.id,
      kind: 'LOCATION_SENSORY',
      body: location.sensoryDetails,
      authorId: user.id
    });

    await prisma.location.create({
      data: {
        id: location.id,
        projectId: project.id,
        name: location.name,
        type: location.type,
        descriptionWritingId,
        atmosphereWritingId,
        significanceWritingId,
        sensoryWritingId
      }
    });
  }

  const actIds = new Map<string, string>();
  for (const [index, act] of initialActs.entries()) {
    const created = await prisma.act.create({
      data: { id: act.id, projectId: project.id, title: act.title, order: index }
    });
    actIds.set(act.id, created.id);
  }

  for (const chapter of initialChapters) {
    const act = initialActs.find((candidate) => candidate.chapterIds.includes(chapter.id));
    const bodyWritingId = await createWriting({
      projectId: project.id,
      kind: 'CHAPTER_BODY',
      body: chapter.content,
      authorId: user.id
    });

    await prisma.chapter.create({
      data: {
        id: chapter.id,
        projectId: project.id,
        actId: act ? actIds.get(act.id) : undefined,
        number: chapter.number,
        title: chapter.title,
        status: chapterStatusMap[chapter.status],
        povCharacterId: chapter.povCharacterId,
        locationId: chapter.locationId,
        summary: chapter.summary,
        bodyWritingId,
        order: act ? act.chapterIds.indexOf(chapter.id) : chapter.number
      }
    });
  }

  console.log('Seed complete');
  console.log('Demo login: demo@opentales.local / password123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
