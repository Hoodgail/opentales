import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { generateDocx, generateProjectArchive, type ManuscriptSnapshot, type ProjectArchivePayload } from './exportFormats.js';
import { inspectZip, parseImportFile } from './importParsers.js';

describe('secure import parsing', () => {
  it('previews Markdown chapter structure without applying it', async () => {
    const parsed = await parseImportFile(Buffer.from('# Chapter 1: Arrival\n\nFirst body.\n\n# Chapter 2: Cost\n\nSecond body.'), 'novel.md', 'text/markdown');
    expect(parsed.format).toBe('markdown');
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(['Arrival', 'Cost']);
    expect(parsed.chapters[1].body).toBe('Second body.');
  });

  it('sanitizes active HTML and extracts headings/paragraphs only', async () => {
    const parsed = await parseImportFile(Buffer.from('<h1>Chapter 1: Safe</h1><script>steal()</script><p>Hello <img src=x onerror=steal()>world.</p>'), 'novel.html', 'text/html');
    expect(parsed.chapters[0].body).toBe('Hello world.');
    expect(JSON.stringify(parsed)).not.toContain('steal');
  });

  it('imports generated DOCX headings and text from real OOXML', async () => {
    const snapshot: ManuscriptSnapshot = {
      projectId: 'p', projectTitle: 'DOCX Import', description: null, genre: null, authorName: 'Author', target: 'main', buildRunId: null, compilationId: null,
      branchName: 'main', contentHash: 'a'.repeat(64), totalWordCount: 2, branchHeads: [],
      chapters: [{ sourceId: 'c', key: 'c', number: 1, title: 'Door', summary: null, body: 'The door opened.', wordCount: 3, writingId: 'w', branchId: 'b', versionId: 'v', contentHash: 'b'.repeat(64) }]
    };
    const docx = await generateDocx(snapshot, { includeTitlePage: false });
    const parsed = await parseImportFile(docx.buffer, 'novel.docx', docx.mimeType);
    expect(parsed.format).toBe('docx');
    expect(parsed.chapters.some((chapter) => chapter.title === 'Door')).toBe(true);
    expect(parsed.chapters.map((chapter) => chapter.body).join(' ')).toContain('The door opened.');
  });

  it('round-trips OpenTales project JSON inside a safe ZIP', async () => {
    const payload: ProjectArchivePayload = {
      schema: 'opentales.project-archive.v1', exportedAt: new Date().toISOString(), source: { projectId: 'old', target: 'main', buildRunId: null },
      project: { title: 'Archive' }, chapters: [{ id: 'old-chapter', number: 1, title: 'Imported', body: 'Archive body.', scenes: [] }],
      characters: [], locations: [], acts: [], obstacles: [], relationships: [], docs: [], storyStructure: null, build: null, assets: []
    };
    const archive = await generateProjectArchive(payload, []);
    const parsed = await parseImportFile(archive.buffer, 'book.opentales.zip', archive.mimeType);
    expect(parsed.archive?.schema).toBe(payload.schema);
    expect(parsed.chapters[0]).toMatchObject({ sourceId: 'old-chapter', title: 'Imported', body: 'Archive body.' });
    const rawJson = await parseImportFile(Buffer.from(JSON.stringify(payload)), 'project.json', 'application/json');
    expect(rawJson).toMatchObject({ format: 'project-archive', mimeType: 'application/json' });
  });

  it('rejects path traversal, MIME spoofing, and compression bombs before extraction', async () => {
    const traversal = new JSZip();
    traversal.file('../escape.txt', 'bad');
    const traversalBytes = await traversal.generateAsync({ type: 'nodebuffer' });
    expect(() => inspectZip(traversalBytes)).toThrow(/path traversal|Unsafe ZIP path/i);

    await expect(parseImportFile(Buffer.from('# Chapter 1\n\nText'), 'novel.md', 'image/png')).rejects.toMatchObject({ status: 400 });

    const bomb = new JSZip();
    bomb.file('project.json', 'A'.repeat(5 * 1024 * 1024));
    const bombBytes = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    expect(() => inspectZip(bombBytes)).toThrow(/compression ratio/i);
  });
});
