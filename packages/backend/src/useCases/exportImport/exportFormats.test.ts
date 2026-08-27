import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  generateDocx,
  generateEpub,
  generateHtml,
  generateMarkdownBundle,
  generatePdf,
  generatePlainText,
  generateProjectArchive,
  safeArchivePath,
  sha256,
  type ManuscriptSnapshot,
  type ProjectArchivePayload
} from './exportFormats.js';

const run = promisify(execFile);
const snapshot: ManuscriptSnapshot = {
  projectId: 'project-1', projectTitle: 'The Cartographer’s Debt', description: 'A memory-cost fantasy.', genre: 'Fantasy',
  authorName: 'Mara Vale', target: 'main', buildRunId: null, compilationId: null, branchName: 'main',
  contentHash: 'a'.repeat(64), totalWordCount: 28,
  branchHeads: [
    { sourceId: 'c1', writingId: 'w1', branchId: 'b1', versionId: 'v1', contentHash: 'b'.repeat(64) },
    { sourceId: 'c2', writingId: 'w2', branchId: 'b2', versionId: 'v2', contentHash: 'c'.repeat(64) }
  ],
  chapters: [
    { sourceId: 'c1', key: 'chapter-1', number: 1, title: 'Ink and Absence', summary: null, body: 'Mara unfolded the map. **Nothing stayed.**\n\n***\n\n“Remember me,” Elias said.', wordCount: 12, writingId: 'w1', branchId: 'b1', versionId: 'v1', contentHash: 'b'.repeat(64) },
    { sourceId: 'c2', key: 'chapter-2', number: 2, title: 'The Vanished Street', summary: null, body: 'The street returned at midnight, but every window reflected a stranger.', wordCount: 16, writingId: 'w2', branchId: 'b2', versionId: 'v2', contentHash: 'c'.repeat(64) }
  ]
};

describe('production manuscript exporters', () => {
  it('creates valid US Letter OOXML with manuscript spacing, indents, headers, page fields and chapter breaks', async () => {
    const output = await generateDocx(snapshot, { includeTitlePage: true, chapterNumbering: true, preset: 'standard-manuscript' });
    const zip = await JSZip.loadAsync(output.buffer);
    const [document, styles, header] = await Promise.all([
      zip.file('word/document.xml')!.async('text'),
      zip.file('word/styles.xml')!.async('text'),
      zip.file('word/header1.xml')!.async('text')
    ]);
    expect(document).toContain('w:w="12240"');
    expect(document).toContain('w:h="15840"');
    expect(document).toContain('w:top="1440"');
    expect(document).toContain('w:firstLine="720"');
    expect(document).toContain('<w:pageBreakBefore/>');
    expect(styles).toContain('Times New Roman');
    expect(styles).toContain('w:line="480"');
    expect(header).toContain('PAGE');
    expect(document).toContain('Ink and Absence');
    const reading = await generateDocx(snapshot, { preset: 'reading-copy' });
    const readingXml = await (await JSZip.loadAsync(reading.buffer)).file('word/document.xml')!.async('text');
    expect(readingXml).toContain('w:line="360"');
    expect(readingXml).toContain('w:firstLine="540"');
  });

  it('creates a loadable Letter PDF with metadata, page numbers, and extractable manuscript text', async () => {
    const output = await generatePdf(snapshot, { includeTitlePage: true, chapterNumbering: true });
    const pdf = await PDFDocument.load(output.buffer);
    expect(pdf.getTitle()).toBe(snapshot.projectTitle);
    expect(pdf.getAuthor()).toBe(snapshot.authorName);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const temp = await mkdtemp(path.join(os.tmpdir(), 'opentales-pdf-test-'));
    try {
      const pdfPath = path.join(temp, 'sample.pdf');
      const textPath = path.join(temp, 'sample.txt');
      await writeFile(pdfPath, output.buffer);
      try {
        await run('pdftotext', [pdfPath, textPath]);
        const { readFile } = await import('node:fs/promises');
        const text = await readFile(textPath, 'utf8');
        expect(text).toContain('Ink and Absence');
        expect(text).toContain('Mara unfolded the map.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } finally { await rm(temp, { recursive: true, force: true }); }
  });

  it('creates EPUB3 with first uncompressed mimetype, container, OPF manifest/nav/spine and XHTML chapters', async () => {
    const output = await generateEpub(snapshot, { chapterNumbering: true });
    expect(output.buffer.readUInt16LE(8)).toBe(0);
    expect(output.buffer.subarray(30, 38).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(output.buffer);
    expect(await zip.file('mimetype')!.async('text')).toBe('application/epub+zip');
    const opf = await zip.file('OEBPS/content.opf')!.async('text');
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('text');
    expect(opf).toContain('version="3.0"');
    expect(opf).toContain('properties="nav"');
    expect(opf.match(/<itemref /g)).toHaveLength(3);
    expect(nav).toContain('Chapter 2: The Vanished Street');
    expect(await zip.file('OEBPS/chapter-001.xhtml')!.async('text')).toContain('Remember me');
  });

  it('generates bounded text, escaped HTML, markdown bundle and round-trippable project archive', async () => {
    const text = generatePlainText(snapshot, {});
    expect(text.buffer.toString()).toContain('Chapter 1: Ink and Absence');
    const html = generateHtml({ ...snapshot, chapters: [{ ...snapshot.chapters[0], body: '<script>alert(1)</script> Safe.' }] }, {});
    expect(html.buffer.toString()).not.toContain('<script>');
    expect(html.buffer.toString()).toContain('&lt;script&gt;');
    const markdown = await generateMarkdownBundle(snapshot, {});
    const markdownZip = await JSZip.loadAsync(markdown.buffer);
    expect(markdownZip.file('manifest.json')).toBeTruthy();
    expect(markdownZip.file('chapters/001-ink-and-absence.md')).toBeTruthy();
    const payload: ProjectArchivePayload = {
      schema: 'opentales.project-archive.v1', exportedAt: new Date().toISOString(),
      source: { projectId: 'p', target: 'main', buildRunId: null }, project: { title: 'Round Trip' },
      chapters: [], characters: [], locations: [], acts: [], obstacles: [], relationships: [], docs: [], storyStructure: null, build: null, assets: []
    };
    const archive = await generateProjectArchive(payload, [{ path: 'assets/cover.txt', data: Buffer.from('cover') }]);
    const archiveZip = await JSZip.loadAsync(archive.buffer);
    expect(JSON.parse(await archiveZip.file('project.json')!.async('text')).schema).toBe(payload.schema);
    expect(await archiveZip.file('assets/cover.txt')!.async('text')).toBe('cover');
    expect(sha256(archive.buffer)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => safeArchivePath('../escape.txt')).toThrow(/Unsafe archive path/);
  });
});
