import type { BetaShareLink as PrismaBetaShareLink } from '@prisma/client';
import type { BetaShareLink } from '@opentales/sdk';

export function toBetaShareLink(row: PrismaBetaShareLink): BetaShareLink {
  return {
    id: row.id,
    projectId: row.projectId,
    token: row.token,
    chapterIds: row.chapterIds,
    allowComments: row.allowComments,
    label: row.label,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  };
}
