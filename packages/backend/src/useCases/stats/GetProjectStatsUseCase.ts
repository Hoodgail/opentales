import type { PrismaClient } from '@prisma/client';
import type { ProjectStats, ProjectStatsDay } from '@opentales/sdk';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

const DEFAULT_DAYS = 90;

export class GetProjectStatsUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async execute(
    userId: string,
    projectId: string,
    days = DEFAULT_DAYS
  ): Promise<ProjectStats> {
    await this.access.assertProjectAccess(userId, projectId);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days + 1);

    // Pull every WritingVersion belonging to the project's writings within the
    // requested window. We compute deltas client-side rather than via raw SQL
    // for clarity — version counts per project are small (hundreds, maybe a
    // few thousand) so this is fine.
    const versions = await this.prisma.writingVersion.findMany({
      where: {
        branch: { writing: { projectId } },
        createdAt: { gte: since }
      },
      orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        branchId: true,
        wordCount: true,
        createdAt: true,
        parentVersionId: true,
        parentVersion: { select: { wordCount: true } }
      }
    });

    const perDay = new Map<string, { wordsAdded: number; versions: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      perDay.set(toIsoDate(d), { wordsAdded: 0, versions: 0 });
    }

    for (const v of versions) {
      const date = toIsoDate(v.createdAt);
      const slot = perDay.get(date);
      if (!slot) continue;
      const prevWords = v.parentVersion?.wordCount ?? 0;
      const delta = Math.max(0, v.wordCount - prevWords);
      slot.wordsAdded += delta;
      slot.versions += 1;
    }

    const series: ProjectStatsDay[] = Array.from(perDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, value]) => ({
        date,
        wordsAdded: value.wordsAdded,
        versions: value.versions
      }));

    const totalWordsAdded = series.reduce((s, d) => s + d.wordsAdded, 0);
    const totalVersions = series.reduce((s, d) => s + d.versions, 0);

    // Current word count = sum of head versions per chapter body.
    const headTotals = await this.prisma.chapter.findMany({
      where: { projectId, deletedAt: null },
      include: {
        bodyWriting: {
          include: { defaultBranch: { include: { headVersion: true } } }
        }
      }
    });
    const totalWords = headTotals.reduce((s, c) => {
      return s + (c.bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0);
    }, 0);

    const streak = computeStreak(series);

    return {
      projectId,
      totalWords,
      totalWordsAddedInWindow: totalWordsAdded,
      totalVersionsInWindow: totalVersions,
      currentStreakDays: streak,
      windowDays: days,
      days: series
    };
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeStreak(series: ProjectStatsDay[]): number {
  // Walk backwards from the end. Stop on the first day with zero words added.
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].wordsAdded > 0) streak += 1;
    else break;
  }
  return streak;
}
