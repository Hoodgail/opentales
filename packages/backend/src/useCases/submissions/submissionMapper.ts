import type { Prisma } from '@prisma/client';
import type {
  ActivityType,
  SubmissionActivity,
  SubmissionAuthor,
  SubmissionDetail,
  SubmissionKind,
  SubmissionStatus,
  SubmissionSummary
} from '@opentales/sdk';

export const submissionInclude = {
  author: { select: { id: true, username: true, name: true } },
  decidedBy: { select: { id: true, username: true, name: true } },
  chapter: { select: { id: true, title: true } }
} satisfies Prisma.SubmissionInclude;

export const submissionDetailInclude = {
  ...submissionInclude,
  baseVersion: { select: { body: true } },
  branch: {
    include: {
      headVersion: { select: { body: true } }
    }
  },
  activities: {
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, username: true, name: true } }
    }
  }
} satisfies Prisma.SubmissionInclude;

export type SubmissionWithSummary = Prisma.SubmissionGetPayload<{
  include: typeof submissionInclude;
}>;

export type SubmissionWithDetail = Prisma.SubmissionGetPayload<{
  include: typeof submissionDetailInclude;
}>;

function toAuthor(
  user: { id: string; username: string; name: string | null } | null
): SubmissionAuthor | null {
  return user ? { id: user.id, username: user.username, name: user.name } : null;
}

function toAuthorRequired(user: {
  id: string;
  username: string;
  name: string | null;
}): SubmissionAuthor {
  return { id: user.id, username: user.username, name: user.name };
}

const KIND_MAP = {
  CHAPTER_EDIT: 'chapter-edit',
  NEW_CHAPTER: 'new-chapter'
} as const;

const STATUS_MAP = {
  OPEN: 'open',
  MERGED: 'merged',
  DECLINED: 'declined'
} as const;

const ACTIVITY_TYPE_MAP = {
  SUBMISSION_OPENED: 'submission-opened',
  SUBMISSION_MERGED: 'submission-merged',
  SUBMISSION_DECLINED: 'submission-declined',
  COMMENT_ADDED: 'comment-added',
  AI_REVIEW_POSTED: 'ai-review-posted'
} as const;

export function fromSdkKind(kind: SubmissionKind): keyof typeof KIND_MAP {
  return kind === 'chapter-edit' ? 'CHAPTER_EDIT' : 'NEW_CHAPTER';
}

export function toSubmissionSummary(submission: SubmissionWithSummary): SubmissionSummary {
  return {
    id: submission.id,
    projectId: submission.projectId,
    kind: KIND_MAP[submission.kind],
    status: STATUS_MAP[submission.status],
    title: submission.title,
    message: submission.message,
    chapterId: submission.chapterId,
    chapterTitle: submission.chapter?.title ?? null,
    proposedTitle: submission.proposedTitle,
    proposedNumber: submission.proposedNumber,
    proposedActId: submission.proposedActId,
    author: toAuthorRequired(submission.author),
    createdAt: submission.createdAt.toISOString(),
    decidedAt: submission.decidedAt ? submission.decidedAt.toISOString() : null,
    decidedBy: toAuthor(submission.decidedBy)
  };
}

function toSubmissionActivity(
  activity: SubmissionWithDetail['activities'][number]
): SubmissionActivity {
  return {
    id: activity.id,
    type: ACTIVITY_TYPE_MAP[activity.type] as ActivityType,
    content: activity.content ?? null,
    author: toAuthor(activity.author),
    createdAt: activity.createdAt.toISOString()
  };
}

export function toSubmissionDetail(submission: SubmissionWithDetail): SubmissionDetail {
  const summary = toSubmissionSummary(submission);
  return {
    ...summary,
    baseBody: submission.baseVersion?.body ?? '',
    headBody: submission.branch.headVersion?.body ?? '',
    activities: submission.activities.map(toSubmissionActivity)
  };
}

export function toStatus(value: SubmissionStatus): keyof typeof STATUS_MAP {
  return value === 'merged' ? 'MERGED' : value === 'declined' ? 'DECLINED' : 'OPEN';
}
