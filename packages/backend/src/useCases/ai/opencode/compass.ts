import type { PrismaClient } from '@prisma/client';
import { bodyOf } from '../tools/shared.js';

/**
 * The "project compass": a compact, always-current map of the project that is
 * injected into every agent turn. It is what lets a brand-new session — or a
 * session right after context compaction — know where the work stands without
 * re-reading the manuscript: what exists, where planning docs live, what the
 * workflow ledger says to do next, and what the agent left itself as notes.
 *
 * Everything here is data read from the database, never model memory.
 */

export const STORY_BIBLE_FOLDER = 'Story Bible';
export const LEDGER_TITLE = 'Ledger';

/** Section headings in the ledger doc that are surfaced verbatim every turn. */
const LEDGER_SURFACED_SECTIONS = ['Now', 'Next action', 'Notes to future self', 'Standing corrections', 'Open questions'];
const LEDGER_SECTION_CHARS = 1_800;
const TREE_DOC_LIMIT = 80;
const CHAPTER_LIMIT = 60;

interface CompassInput {
  prisma: PrismaClient;
  projectId: string;
}

export async function projectCompass({ prisma, projectId }: CompassInput): Promise<string> {
  const [folders, docs, chapterRows, characters, locations, acts, obstacles, structure] = await Promise.all([
    prisma.projectFolder.findMany({ where: { projectId }, select: { id: true, path: true }, orderBy: { path: 'asc' } }),
    prisma.projectDoc.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        kind: true,
        folderId: true,
        updatedAt: true,
        bodyWriting: { select: { defaultBranch: { select: { headVersion: { select: { wordCount: true } } } } } }
      },
      orderBy: [{ folderId: 'asc' }, { order: 'asc' }]
    }),
    prisma.chapter.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        summary: true,
        bodyWriting: { select: { defaultBranch: { select: { headVersion: { select: { wordCount: true } } } } } },
        scenes: { select: { status: true, actualWordCount: true } }
      },
      orderBy: { number: 'asc' }
    }),
    prisma.character.count({ where: { projectId } }),
    prisma.location.count({ where: { projectId } }),
    prisma.act.count({ where: { projectId } }),
    prisma.obstacle.count({ where: { projectId } }),
    prisma.storyStructure.findUnique({
      where: { projectId },
      select: { loglineWriting: { select: { defaultBranch: { select: { headVersion: { select: { body: true } } } } } } }
    })
  ]);

  const folderPath = new Map(folders.map((folder) => [folder.id, folder.path]));
  const words = (row: { bodyWriting: { defaultBranch: { headVersion: { wordCount: number } | null } | null } }) =>
    row.bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0;

  const docLines = docs.slice(0, TREE_DOC_LIMIT).map((doc) => {
    const where = doc.folderId ? `${folderPath.get(doc.folderId) ?? '?'}/` : '';
    return `- ${where}${doc.title} [${doc.kind.toLowerCase()}, ${words(doc)}w] id=${doc.id}`;
  });
  const emptyFolders = folders.filter((folder) => !docs.some((doc) => doc.folderId === folder.id)).map((folder) => `- ${folder.path}/ (empty)`);

  const manuscriptWords = chapterRows.reduce((sum, chapter) => sum + words(chapter), 0);
  const chapterLines = chapterRows.slice(0, CHAPTER_LIMIT).map((chapter) => {
    const sceneCount = chapter.scenes.length;
    const draftedScenes = chapter.scenes.filter((scene) => scene.actualWordCount > 0).length;
    const scenes = sceneCount ? `, scenes ${draftedScenes}/${sceneCount} drafted` : '';
    return `- Ch ${chapter.number} "${chapter.title}" [${chapter.status.toLowerCase()}, ${words(chapter)}w${scenes}] id=${chapter.id}`;
  });

  const ledgerDoc = docs.find(
    (doc) => doc.title.toLowerCase() === LEDGER_TITLE.toLowerCase() && folderPath.get(doc.folderId ?? '') === STORY_BIBLE_FOLDER
  ) ?? docs.find((doc) => /ledger/i.test(doc.title));
  const ledger = ledgerDoc ? await readLedgerSections(prisma, ledgerDoc.id) : null;
  const logline = structure?.loglineWriting.defaultBranch?.headVersion?.body?.trim();

  const lines = [
    '## Project compass',
    'Live state of this project, regenerated every turn from the database. Trust it over your memory of earlier turns.',
    '',
    `Counts: ${chapterRows.length} chapters (${manuscriptWords.toLocaleString('en-US')} manuscript words), ${characters} characters, ${locations} locations, ${acts} acts, ${obstacles} obstacles, ${docs.length} docs.`,
    logline ? `Logline: ${logline.slice(0, 300)}` : 'Logline: (not set — story structure is empty)',
    '',
    '### Docs',
    docLines.length ? docLines.join('\n') : '- (no docs yet)',
    docs.length > TREE_DOC_LIMIT ? `- …and ${docs.length - TREE_DOC_LIMIT} more (listProjectFiles)` : '',
    emptyFolders.length ? emptyFolders.join('\n') : '',
    '',
    '### Manuscript',
    chapterLines.length ? chapterLines.join('\n') : '- (no chapters yet)',
    chapterRows.length > CHAPTER_LIMIT ? `- …and ${chapterRows.length - CHAPTER_LIMIT} more (listChapters)` : '',
    '',
    ledger
      ? `### From the ledger (${ledgerDoc!.title}, id=${ledgerDoc!.id})\n${ledger}`
      : `### Ledger\nNo ledger exists yet. Before doing multi-step work, create folder "${STORY_BIBLE_FOLDER}" and a "${LEDGER_TITLE}" doc in it (see the novel-studio skill) so this compass can tell your future self what to do next.`
  ];
  return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n').trim();
}

async function readLedgerSections(prisma: PrismaClient, docId: string): Promise<string | null> {
  const doc = await prisma.projectDoc.findUnique({
    where: { id: docId },
    select: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
  });
  if (!doc) return null;
  const body = bodyOf(doc.bodyWriting);
  const sections = extractSections(body, LEDGER_SURFACED_SECTIONS);
  if (!sections.length) return body.trim() ? `${body.trim().slice(0, LEDGER_SECTION_CHARS)}${body.length > LEDGER_SECTION_CHARS ? '\n…' : ''}` : null;
  return sections.map(({ heading, text }) => `#### ${heading}\n${text}`).join('\n');
}

/** Pull `## Heading` sections (any level) whose title starts with one of the wanted names. */
export function extractSections(markdown: string, wanted: string[]): Array<{ heading: string; text: string }> {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const found: Array<{ heading: string; text: string }> = [];
  let current: { heading: string; lines: string[]; level: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join('\n').trim();
    if (text) {
      found.push({
        heading: current.heading,
        text: text.length > LEDGER_SECTION_CHARS ? `${text.slice(0, LEDGER_SECTION_CHARS)}\n…(truncated — read the ledger for the rest)` : text
      });
    }
    current = null;
  };
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) {
      const level = match[1].length;
      if (current && level <= current.level) flush();
      const title = match[2];
      if (!current && wanted.some((name) => title.toLowerCase().startsWith(name.toLowerCase()))) {
        current = { heading: title, lines: [], level };
        continue;
      }
    }
    current?.lines.push(line);
  }
  flush();
  return found;
}
