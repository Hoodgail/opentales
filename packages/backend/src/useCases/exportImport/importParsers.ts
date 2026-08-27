import path from 'node:path';
import { load } from 'cheerio';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import type {
  ImportPreviewChapter,
  ImportPreviewScene,
  JsonValue,
  ProjectImportFormat
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import type { ProjectArchivePayload } from './exportFormats.js';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_COMPRESSION_RATIO = 100;
const MAX_CHAPTERS = 2_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface ParsedImport {
  format: ProjectImportFormat;
  mimeType: string;
  chapters: ImportPreviewChapter[];
  sourceMetadata: Record<string, JsonValue>;
  archive: ProjectArchivePayload | null;
}

export async function parseImportFile(buffer: Buffer, filename: string, declaredMimeType?: string): Promise<ParsedImport> {
  if (!buffer.length) throw new HttpError(400, 'Import file is empty');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Import exceeds the 50 MB compressed/upload limit');
  if (buffer.includes(0) && !isZip(buffer)) throw new HttpError(400, 'Text imports may not contain NUL bytes');
  const extension = path.extname(filename).toLowerCase();
  let parsed: ParsedImport;
  if (isZip(buffer)) {
    const inventory = inspectZip(buffer);
    const names = new Set(inventory.entries.map((entry) => entry.name));
    if (names.has('[Content_Types].xml') && names.has('word/document.xml')) parsed = await parseDocx(buffer, filename, inventory);
    else if (names.has('project.json')) parsed = await parseProjectArchive(buffer, filename, inventory);
    else throw new HttpError(400, 'ZIP import is neither a valid DOCX nor an OpenTales project archive');
  } else if (extension === '.html' || extension === '.htm') {
    parsed = parseHtml(decodeUtf8(buffer), filename);
  } else if (extension === '.md' || extension === '.markdown') {
    parsed = parseMarkdown(decodeUtf8(buffer), filename);
  } else if (extension === '.json') {
    parsed = parseArchiveJson(decodeUtf8(buffer), filename);
  } else if (extension === '.txt' || !extension) {
    parsed = parseText(decodeUtf8(buffer), filename);
  } else {
    throw new HttpError(400, `Unsupported import extension '${extension}'`);
  }
  assertDeclaredMime(declaredMimeType, parsed.format);
  validateChapters(parsed.chapters);
  return parsed;
}

export interface ZipInventory {
  entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }>;
  compressedBytes: number;
  uncompressedBytes: number;
}

export function inspectZip(buffer: Buffer): ZipInventory {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset < 0) throw new HttpError(400, 'ZIP end-of-central-directory record is missing');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES) throw new HttpError(413, `ZIP contains more than ${MAX_ZIP_ENTRIES} entries`);
  if (centralOffset + centralSize > buffer.length) throw new HttpError(400, 'ZIP central directory is out of bounds');
  const entries: ZipInventory['entries'] = [];
  const seen = new Set<string>();
  let cursor = centralOffset;
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new HttpError(400, 'ZIP central directory is malformed');
    const flags = buffer.readUInt16LE(cursor + 8);
    if ((flags & 0x1) !== 0) throw new HttpError(400, 'Encrypted ZIP entries are not supported');
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > buffer.length) throw new HttpError(400, 'ZIP filename is out of bounds');
    const name = buffer.subarray(cursor + 46, nameEnd).toString((flags & 0x800) !== 0 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    assertSafeZipPath(name);
    if (seen.has(name)) throw new HttpError(400, `ZIP contains duplicate path '${name}'`);
    seen.add(name);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new HttpError(400, `ZIP symlink '${name}' is not allowed`);
    compressedBytes += compressedSize;
    uncompressedBytes += uncompressedSize;
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new HttpError(413, `ZIP entry '${name}' is too large`);
    entries.push({ name, compressedSize, uncompressedSize });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new HttpError(413, 'ZIP expands beyond the 120 MB limit');
  if (compressedBytes > 0 && uncompressedBytes / compressedBytes > MAX_COMPRESSION_RATIO) throw new HttpError(413, 'ZIP compression ratio exceeds the safety limit');
  return { entries, compressedBytes, uncompressedBytes };
}

async function parseDocx(buffer: Buffer, filename: string, inventory: ZipInventory): Promise<ParsedImport> {
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: ['p[style-name="Title"] => h1:fresh', 'p[style-name="Heading 1"] => h1:fresh', 'p[style-name="Heading 2"] => h2:fresh']
  });
  const html = sanitize(result.value);
  return {
    format: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    chapters: chaptersFromHtml(html, filename),
    sourceMetadata: { warnings: result.messages.map((message) => message.message), zipEntries: inventory.entries.length },
    archive: null
  };
}

function parseMarkdown(value: string, filename: string): ParsedImport {
  return { format: 'markdown', mimeType: 'text/markdown; charset=utf-8', chapters: splitMarkdown(value, filename), sourceMetadata: {}, archive: null };
}

function parseText(value: string, filename: string): ParsedImport {
  return { format: 'text', mimeType: 'text/plain; charset=utf-8', chapters: splitPlainText(value, filename), sourceMetadata: {}, archive: null };
}

function parseHtml(value: string, filename: string): ParsedImport {
  const sanitized = sanitize(value);
  return { format: 'html', mimeType: 'text/html; charset=utf-8', chapters: chaptersFromHtml(sanitized, filename), sourceMetadata: { sanitized: true }, archive: null };
}

async function parseProjectArchive(buffer: Buffer, filename: string, inventory: ZipInventory): Promise<ParsedImport> {
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });
  const file = zip.file('project.json');
  if (!file) throw new HttpError(400, 'Project archive is missing project.json');
  const json = await file.async('text');
  const parsed = parseArchivePayload(json);
  return archiveResult(parsed, filename, { zipEntries: inventory.entries.length, uncompressedBytes: inventory.uncompressedBytes }, 'application/vnd.opentales.project+zip');
}

function parseArchiveJson(value: string, filename: string): ParsedImport {
  return archiveResult(parseArchivePayload(value), filename, { container: 'json' }, 'application/json');
}

function archiveResult(payload: ProjectArchivePayload, _filename: string, extra: Record<string, JsonValue>, mimeType: string): ParsedImport {
  const chapters = payload.chapters.map((raw, index) => archiveChapter(raw, index));
  return {
    format: 'project-archive',
    mimeType,
    chapters,
    sourceMetadata: {
      schema: payload.schema,
      source: payload.source,
      projectTitle: stringValue(payload.project.title) ?? 'Imported OpenTales project',
      structuredArtifacts: arrayValue(objectValue(payload.build).artifacts).length,
      ...extra
    },
    archive: payload
  };
}

function parseArchivePayload(value: string): ProjectArchivePayload {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new HttpError(400, 'project.json is not valid JSON'); }
  const record = objectValue(parsed);
  if (record.schema !== 'opentales.project-archive.v1') throw new HttpError(400, 'Unsupported OpenTales project archive schema');
  if (!objectValue(record.project).title || !Array.isArray(record.chapters)) throw new HttpError(400, 'Project archive is missing project metadata or chapters');
  return parsed as ProjectArchivePayload;
}

function splitMarkdown(value: string, filename: string): ImportPreviewChapter[] {
  const matches = [...value.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)];
  const chapterMatches = matches.filter((match) => /^(?:chapter\b|prologue\b|epilogue\b)/i.test(match[1].trim()));
  const selected = chapterMatches.length ? chapterMatches : matches.filter((match) => match[0].startsWith('# '));
  if (!selected.length) return [singleChapter(filename, value)];
  return selected.map((match, index) => ({
    number: chapterNumber(match[1], index + 1),
    title: cleanChapterTitle(match[1], index + 1),
    body: value.slice((match.index ?? 0) + match[0].length, selected[index + 1]?.index ?? value.length).trim(),
    scenes: []
  }));
}

function splitPlainText(value: string, filename: string): ImportPreviewChapter[] {
  const matches = [...value.matchAll(/^(chapter\s+(?:\d+|[ivxlcdm]+)(?:\s*[:.-]\s*.*?)?|prologue|epilogue)\s*$/gim)];
  if (!matches.length) return [singleChapter(filename, value)];
  return matches.map((match, index) => ({
    number: chapterNumber(match[1], index + 1),
    title: cleanChapterTitle(match[1], index + 1),
    body: value.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? value.length).trim(),
    scenes: []
  }));
}

function chaptersFromHtml(value: string, filename: string): ImportPreviewChapter[] {
  const $ = load(value, null, false);
  const headings = $('h1,h2,h3').toArray();
  const chapterHeadings = headings.filter((heading) => /^(?:chapter\b|prologue\b|epilogue\b)/i.test($(heading).text().trim()));
  const selected = chapterHeadings.length ? chapterHeadings : headings;
  if (!selected.length) return [singleChapter(filename, htmlText($, $('body').length ? $('body') : $.root()))];
  return selected.map((heading, index) => {
    const parts: string[] = [];
    let cursor = $(heading).next();
    while (cursor.length && !selected.includes(cursor.get(0)!)) {
      if (/^h[1-3]$/i.test(cursor.get(0)?.tagName ?? '') && selected.includes(cursor.get(0)!)) break;
      if (cursor.is('hr')) parts.push('***');
      else if (cursor.is('p,blockquote,li')) {
        const text = cursor.text().replace(/\s+/g, ' ').trim();
        if (text) parts.push(text);
      }
      cursor = cursor.next();
    }
    const label = $(heading).text().trim();
    return { number: chapterNumber(label, index + 1), title: cleanChapterTitle(label, index + 1), body: parts.join('\n\n'), scenes: [] };
  });
}

function htmlText($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>): string {
  const parts: string[] = [];
  root.find('p,blockquote,li,hr').each((_index, element) => {
    if ($(element).is('hr')) parts.push('***');
    else {
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
  });
  return parts.join('\n\n');
}

function archiveChapter(value: Record<string, JsonValue>, index: number): ImportPreviewChapter {
  const scenes = arrayValue(value.scenes).map((item, sceneIndex): ImportPreviewScene => {
    const scene = objectValue(item);
    return {
      sourceId: stringValue(scene.id),
      title: stringValue(scene.title),
      order: numberValue(scene.order, sceneIndex),
      body: stringValue(scene.body) ?? '',
      metadata: jsonValue(scene)
    };
  });
  return {
    sourceId: stringValue(value.id),
    number: numberValue(value.number, index + 1),
    title: stringValue(value.title) ?? `Chapter ${index + 1}`,
    summary: stringValue(value.summary),
    body: stringValue(value.body) ?? '',
    scenes
  };
}

function singleChapter(filename: string, body: string): ImportPreviewChapter {
  const title = path.basename(filename, path.extname(filename)).replace(/[-_]+/g, ' ').trim() || 'Imported Chapter';
  return { number: 1, title, body: body.trim(), scenes: [] };
}

function sanitize(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ['html', 'body', 'h1', 'h2', 'h3', 'p', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li', 'em', 'strong'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard'
  });
}

function decodeUtf8(buffer: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new HttpError(400, 'Text import is not valid UTF-8'); }
}

function validateChapters(chapters: ImportPreviewChapter[]): void {
  if (!chapters.length) throw new HttpError(400, 'Import contains no chapters');
  if (chapters.length > MAX_CHAPTERS) throw new HttpError(413, `Import contains more than ${MAX_CHAPTERS} chapters`);
  for (const chapter of chapters) {
    if (!chapter.title.trim()) throw new HttpError(400, 'Every imported chapter requires a title');
    if (Buffer.byteLength(chapter.body, 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, `Chapter '${chapter.title}' exceeds the 2 MB body limit`);
    if (chapter.scenes.length > MAX_CHAPTERS) throw new HttpError(413, `Chapter '${chapter.title}' contains too many scenes`);
    for (const scene of chapter.scenes) if (Buffer.byteLength(scene.body, 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, `A scene in '${chapter.title}' exceeds the 2 MB body limit`);
  }
}

function assertDeclaredMime(value: string | undefined, format: ProjectImportFormat): void {
  if (!value || value === 'application/octet-stream') return;
  const accepted: Record<ProjectImportFormat, string[]> = {
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
    markdown: ['text/markdown', 'text/plain'],
    text: ['text/plain'],
    html: ['text/html'],
    'project-archive': ['application/vnd.opentales.project+zip', 'application/zip', 'application/json']
  };
  const base = value.split(';')[0].trim().toLowerCase();
  if (!accepted[format].includes(base)) throw new HttpError(400, `Declared MIME type '${value}' does not match detected ${format} content`);
}

function assertSafeZipPath(name: string): void {
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.includes('\0')) throw new HttpError(400, `Unsafe ZIP path '${name}'`);
  const parts = name.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new HttpError(400, `ZIP path traversal is not allowed: '${name}'`);
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= start; index -= 1) if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  return -1;
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function chapterNumber(value: string, fallback: number): number {
  const match = value.match(/\bchapter\s+(\d+)\b/i);
  return match ? Math.max(1, Number(match[1])) : fallback;
}

function cleanChapterTitle(value: string, fallback: number): string {
  const normalized = value.replace(/^chapter\s+(?:\d+|[ivxlcdm]+)\s*[:.-]?\s*/i, '').trim();
  if (/^prologue$/i.test(value.trim()) || /^epilogue$/i.test(value.trim())) return value.trim();
  return normalized || `Chapter ${fallback}`;
}

function objectValue(value: unknown): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

function arrayValue(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value as JsonValue[] : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
