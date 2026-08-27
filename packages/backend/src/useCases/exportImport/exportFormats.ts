import { createHash, randomUUID } from 'node:crypto';
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  TextRun
} from 'docx';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { JsonValue, ProjectExportOptions, ProjectExportPreset } from '@opentales/sdk';

export type ManuscriptRenderOptions = ProjectExportOptions & { preset?: ProjectExportPreset };

export interface ManuscriptChapterSnapshot {
  sourceId: string;
  key: string;
  number: number;
  title: string;
  summary: string | null;
  body: string;
  wordCount: number;
  writingId: string;
  branchId: string;
  versionId: string;
  contentHash: string;
}

export interface ManuscriptSnapshot {
  projectId: string;
  projectTitle: string;
  description: string | null;
  genre: string | null;
  authorName: string;
  target: 'main' | 'build';
  buildRunId: string | null;
  compilationId: string | null;
  branchName: string;
  contentHash: string;
  totalWordCount: number;
  chapters: ManuscriptChapterSnapshot[];
  branchHeads: Array<{
    sourceId: string;
    writingId: string;
    branchId: string;
    versionId: string;
    contentHash: string;
  }>;
}

export interface GeneratedExport {
  buffer: Buffer;
  extension: string;
  mimeType: string;
  validation: JsonValue;
}

export interface ProjectArchivePayload {
  schema: 'opentales.project-archive.v1';
  exportedAt: string;
  source: { projectId: string; target: 'main' | 'build'; buildRunId: string | null };
  project: Record<string, JsonValue>;
  chapters: Array<Record<string, JsonValue>>;
  characters: Array<Record<string, JsonValue>>;
  locations: Array<Record<string, JsonValue>>;
  acts: Array<Record<string, JsonValue>>;
  obstacles: Array<Record<string, JsonValue>>;
  relationships: Array<Record<string, JsonValue>>;
  docs: Array<Record<string, JsonValue>>;
  storyStructure: Record<string, JsonValue> | null;
  build: Record<string, JsonValue> | null;
  assets: Array<Record<string, JsonValue>>;
}

export async function generateDocx(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): Promise<GeneratedExport> {
  const lineSpacing = options.preset === 'reading-copy' ? 360 : 480;
  const firstLineIndent = options.preset === 'reading-copy' ? 540 : 720;
  const normalParagraph = (text: string, centered = false) => new Paragraph({
    alignment: centered ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
    indent: centered ? undefined : { firstLine: firstLineIndent },
    spacing: { line: lineSpacing, lineRule: LineRuleType.AUTO, after: 0 },
    children: [new TextRun({ text, font: 'Times New Roman', size: 24 })]
  });
  const children: Paragraph[] = [];
  if (options.includeTitlePage !== false) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, after: 480 },
      children: [new TextRun({ text: snapshot.projectTitle, bold: true, font: 'Times New Roman', size: 28 })]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `by ${snapshot.authorName}`, font: 'Times New Roman', size: 24 })]
    }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  snapshot.chapters.forEach((chapter, chapterIndex) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: chapterIndex > 0 || options.includeTitlePage === false,
      alignment: AlignmentType.CENTER,
      spacing: { before: 1440, after: 480 },
      children: [new TextRun({
        text: chapterHeading(chapter, options.chapterNumbering !== false),
        bold: false,
        font: 'Times New Roman',
        size: 24
      })]
    }));
    for (const block of manuscriptBlocks(chapter.body)) {
      children.push(block.kind === 'scene-break' ? normalParagraph('#', true) : normalParagraph(block.text));
    }
  });
  const document = new Document({
    creator: 'OpenTales',
    title: snapshot.projectTitle,
    subject: snapshot.description ?? snapshot.genre ?? 'Novel manuscript',
    description: `OpenTales ${snapshot.target} manuscript export`,
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
          paragraph: { spacing: { line: lineSpacing, lineRule: LineRuleType.AUTO, after: 0 } }
        }
      },
      paragraphStyles: [{
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: 'Times New Roman', size: 24 },
        paragraph: { alignment: AlignmentType.CENTER, outlineLevel: 0 }
      }]
    },
    sections: [{
      properties: {
        type: SectionType.CONTINUOUS,
        page: {
          size: { width: 12_240, height: 15_840 },
          margin: { top: 1_440, right: 1_440, bottom: 1_440, left: 1_440, header: 720, footer: 720 }
        }
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: `${snapshot.authorName} / ${snapshot.projectTitle} / `, font: 'Times New Roman', size: 20 }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Times New Roman', size: 20 })
          ]
        })] })
      },
      footers: { default: new Footer({ children: [new Paragraph('')] }) },
      children
    }]
  });
  const buffer = await Packer.toBuffer(document);
  const zip = await JSZip.loadAsync(buffer);
  const required = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'];
  const missing = required.filter((name) => !zip.file(name));
  if (missing.length) throw new Error(`Generated DOCX is missing required OOXML parts: ${missing.join(', ')}`);
  const documentXml = await zip.file('word/document.xml')!.async('text');
  if (!documentXml.includes('w:w="12240"') || !documentXml.includes('w:h="15840"')) throw new Error('Generated DOCX is not explicit US Letter');
  return { buffer, extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', validation: { kind: 'ooxml', requiredParts: required, letter: true } };
}

export async function generatePdf(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): Promise<GeneratedExport> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(snapshot.projectTitle);
  pdf.setAuthor(snapshot.authorName);
  pdf.setSubject(snapshot.description ?? snapshot.genre ?? 'Novel manuscript');
  pdf.setCreator('OpenTales');
  pdf.setProducer('OpenTales');
  pdf.setKeywords(['novel', 'manuscript', snapshot.genre ?? 'fiction']);
  const roman = await pdf.embedFont(StandardFonts.TimesRoman);
  const romanBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 72;
  const lineHeight = options.preset === 'reading-copy' ? 18 : 24;
  let pageNumber = 0;
  let page!: PDFPage;
  let y = 0;
  const addPage = (header: boolean) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pageNumber += 1;
    y = pageHeight - margin;
    if (header) {
      const headerText = pdfSafe(`${snapshot.authorName} / ${snapshot.projectTitle} / ${pageNumber}`, roman);
      page.drawText(headerText, { x: pageWidth - margin - roman.widthOfTextAtSize(headerText, 10), y: pageHeight - 48, font: roman, size: 10 });
      y = pageHeight - 96;
    }
  };
  const ensureRoom = (height = lineHeight) => {
    if (y - height < margin) addPage(true);
  };
  if (options.includeTitlePage !== false) {
    addPage(false);
    const title = pdfSafe(snapshot.projectTitle, romanBold);
    page.drawText(title, { x: (pageWidth - romanBold.widthOfTextAtSize(title, 18)) / 2, y: pageHeight * 0.62, font: romanBold, size: 18 });
    const byline = pdfSafe(`by ${snapshot.authorName}`, roman);
    page.drawText(byline, { x: (pageWidth - roman.widthOfTextAtSize(byline, 12)) / 2, y: pageHeight * 0.56, font: roman, size: 12 });
  }
  snapshot.chapters.forEach((chapter) => {
    addPage(true);
    const heading = pdfSafe(chapterHeading(chapter, options.chapterNumbering !== false), roman);
    page.drawText(heading, { x: (pageWidth - roman.widthOfTextAtSize(heading, 12)) / 2, y, font: roman, size: 12 });
    y -= lineHeight * 3;
    for (const block of manuscriptBlocks(chapter.body)) {
      if (block.kind === 'scene-break') {
        ensureRoom(lineHeight * 2);
        const marker = '#';
        page.drawText(marker, { x: (pageWidth - roman.widthOfTextAtSize(marker, 12)) / 2, y, font: roman, size: 12 });
        y -= lineHeight * 2;
        continue;
      }
      const safe = pdfSafe(block.text, roman);
      const lines = wrapPdfText(safe, roman, 12, pageWidth - margin * 2 - 36);
      for (const [index, line] of lines.entries()) {
        ensureRoom();
        page.drawText(line, { x: margin + (index === 0 ? 36 : 0), y, font: roman, size: 12 });
        y -= lineHeight;
      }
    }
  });
  const bytes = await pdf.save({ useObjectStreams: false });
  const buffer = Buffer.from(bytes);
  const loaded = await PDFDocument.load(buffer);
  if (loaded.getPageCount() < snapshot.chapters.length) throw new Error('Generated PDF page count is smaller than the chapter count');
  return { buffer, extension: 'pdf', mimeType: 'application/pdf', validation: { kind: 'pdf', pageCount: loaded.getPageCount(), letter: true } };
}

export async function generateEpub(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): Promise<GeneratedExport> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const identifier = `urn:uuid:${randomUUID()}`;
  const chapters = snapshot.chapters.map((chapter, index) => ({ ...chapter, filename: `chapter-${String(index + 1).padStart(3, '0')}.xhtml` }));
  const navItems = chapters.map((chapter) => `<li><a href="${chapter.filename}">${escapeXml(chapterHeading(chapter, options.chapterNumbering !== false))}</a></li>`).join('');
  zip.file('OEBPS/nav.xhtml', xhtml(snapshot.projectTitle, `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems}</ol></nav>`));
  zip.file('OEBPS/title.xhtml', xhtml(snapshot.projectTitle, `<section class="title-page"><h1>${escapeXml(snapshot.projectTitle)}</h1><p>by ${escapeXml(snapshot.authorName)}</p></section>`));
  zip.file('OEBPS/styles.css', 'body{font-family:serif;line-height:1.5;margin:5%;}p{text-indent:1.5em;margin:0;}h1{text-align:center;margin:20% 0 3em;}p.scene-break{text-align:center;text-indent:0;margin:1.5em 0}.title-page{text-align:center;margin-top:30%}.title-page p{text-indent:0}');
  for (const chapter of chapters) {
    const body = manuscriptBlocks(chapter.body).map((block) => block.kind === 'scene-break'
      ? '<p class="scene-break">#</p>'
      : `<p>${escapeXml(block.text)}</p>`).join('');
    zip.file(`OEBPS/${chapter.filename}`, xhtml(chapter.title, `<section epub:type="chapter"><h1>${escapeXml(chapterHeading(chapter, options.chapterNumbering !== false))}</h1>${body}</section>`));
  }
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((chapter, index) => `<item id="chapter-${index + 1}" href="${chapter.filename}" media-type="application/xhtml+xml"/>`)
  ].join('');
  const spine = ['<itemref idref="title"/>', ...chapters.map((_chapter, index) => `<itemref idref="chapter-${index + 1}"/>`)].join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${escapeXml(snapshot.projectTitle)}</dc:title><dc:creator>${escapeXml(snapshot.authorName)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  validateEpubBytes(buffer, chapters.map((chapter) => chapter.filename));
  return { buffer, extension: 'epub', mimeType: 'application/epub+zip', validation: { kind: 'epub3', chapters: chapters.length, identifier } };
}

export async function generateMarkdownBundle(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): Promise<GeneratedExport> {
  const zip = new JSZip();
  zip.file('README.md', `# ${snapshot.projectTitle}\n\nBy ${snapshot.authorName}\n\n${snapshot.description ?? ''}\n`);
  const files: string[] = [];
  snapshot.chapters.forEach((chapter, index) => {
    const filename = `chapters/${String(index + 1).padStart(3, '0')}-${slugify(chapter.title)}.md`;
    files.push(filename);
    zip.file(filename, `# ${chapterHeading(chapter, options.chapterNumbering !== false)}\n\n${chapter.body.trim()}\n`);
  });
  zip.file('manifest.json', JSON.stringify({ schema: 'opentales.markdown-bundle.v1', title: snapshot.projectTitle, author: snapshot.authorName, contentHash: snapshot.contentHash, chapters: files }, null, 2));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { buffer, extension: 'markdown.zip', mimeType: 'application/zip', validation: { kind: 'markdown-bundle', chapters: files.length } };
}

export function generatePlainText(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): GeneratedExport {
  const chapters = snapshot.chapters.map((chapter) => `${chapterHeading(chapter, options.chapterNumbering !== false)}\n\n${plainManuscript(chapter.body)}`);
  const buffer = Buffer.from(`${snapshot.projectTitle}\nby ${snapshot.authorName}\n\n${chapters.join('\n\n\f\n\n')}\n`, 'utf8');
  return { buffer, extension: 'txt', mimeType: 'text/plain; charset=utf-8', validation: { kind: 'text', chapters: chapters.length } };
}

export function generateHtml(snapshot: ManuscriptSnapshot, options: ManuscriptRenderOptions): GeneratedExport {
  const chapters = snapshot.chapters.map((chapter) => {
    const blocks = manuscriptBlocks(chapter.body).map((block) => block.kind === 'scene-break' ? '<p class="scene-break">#</p>' : `<p>${escapeHtml(block.text)}</p>`).join('\n');
    return `<section class="chapter"><h1>${escapeHtml(chapterHeading(chapter, options.chapterNumbering !== false))}</h1>${blocks}</section>`;
  }).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.projectTitle)}</title><meta name="author" content="${escapeHtml(snapshot.authorName)}"><style>body{max-width:42rem;margin:4rem auto;padding:0 2rem;font-family:Georgia,serif;font-size:1.1rem;line-height:1.65;color:#1b1b1b}header{text-align:center;margin-bottom:6rem}.chapter{break-before:page;margin:5rem 0}.chapter h1{text-align:center;margin-bottom:3rem}.chapter p{text-indent:1.5em;margin:0}.chapter .scene-break{text-indent:0;text-align:center;margin:1.5rem 0}@media print{body{max-width:none;margin:0}.chapter{break-before:page}}</style></head><body><header><h1>${escapeHtml(snapshot.projectTitle)}</h1><p>by ${escapeHtml(snapshot.authorName)}</p></header>${chapters}</body></html>`;
  const buffer = Buffer.from(html, 'utf8');
  return { buffer, extension: 'html', mimeType: 'text/html; charset=utf-8', validation: { kind: 'html5', chapters: snapshot.chapters.length } };
}

export async function generateProjectArchive(
  payload: ProjectArchivePayload,
  assetFiles: Array<{ path: string; data: Buffer }>
): Promise<GeneratedExport> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.opentales.project+zip', { compression: 'STORE' });
  zip.file('project.json', JSON.stringify(payload, null, 2));
  for (const file of assetFiles) zip.file(safeArchivePath(file.path), file.data);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const loaded = await JSZip.loadAsync(buffer);
  if (!loaded.file('project.json') || !loaded.file('mimetype')) throw new Error('Generated project archive is missing required files');
  return { buffer, extension: 'opentales.zip', mimeType: 'application/vnd.opentales.project+zip', validation: { kind: 'project-archive', schema: payload.schema, assets: assetFiles.length } };
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function safeFilename(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[^a-zA-Z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return normalized.slice(0, 120) || 'opentales-manuscript';
}

export function safeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) throw new Error(`Unsafe archive path: ${value}`);
  return parts.map((part) => part.replace(/[^a-zA-Z0-9._ -]/g, '_')).join('/');
}

function chapterHeading(chapter: Pick<ManuscriptChapterSnapshot, 'number' | 'title'>, numbered: boolean): string {
  return numbered ? `Chapter ${chapter.number}: ${chapter.title}` : chapter.title;
}

export function manuscriptBlocks(markdown: string): Array<{ kind: 'paragraph' | 'scene-break'; text: string }> {
  const normalized = markdown.replace(/\r\n?/g, '\n').replace(/<!--([\s\S]*?)-->/g, '');
  return normalized.split(/\n\s*\n/).flatMap((raw): Array<{ kind: 'paragraph' | 'scene-break'; text: string }> => {
    const value = raw.trim();
    if (!value) return [];
    if (/^(?:\*\s*\*\s*\*|-\s*-\s*-|#)$/.test(value)) return [{ kind: 'scene-break' as const, text: '#' }];
    return [{ kind: 'paragraph' as const, text: stripInlineMarkdown(value.replace(/\n+/g, ' ')) }];
  });
}

function plainManuscript(markdown: string): string {
  return manuscriptBlocks(markdown).map((block) => block.kind === 'scene-break' ? '#' : block.text).join('\n\n');
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/g, '$1')
    .replace(/(?:\*|_)(.*?)(?:\*|_)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/, '')
    .trim();
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = '';
    for (const character of word) {
      if (fragment && font.widthOfTextAtSize(fragment + character, size) > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else fragment += character;
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

function pdfSafe(value: string, font: PDFFont): string {
  const normalized = value.replace(/\t/g, ' ').replace(/[\u2010\u2011]/g, '-').replace(/\u2026/g, '...');
  return [...normalized].map((character) => {
    try { font.encodeText(character); return character; }
    catch { return character === '\n' ? ' ' : '?'; }
  }).join('');
}

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
}

function validateEpubBytes(buffer: Buffer, chapterFiles: string[]): void {
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('Generated EPUB is not a ZIP archive');
  const compressionMethod = buffer.readUInt16LE(8);
  const filenameLength = buffer.readUInt16LE(26);
  const firstName = buffer.subarray(30, 30 + filenameLength).toString('utf8');
  if (firstName !== 'mimetype' || compressionMethod !== 0) throw new Error('EPUB mimetype must be the first uncompressed entry');
  void chapterFiles;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

function slugify(value: string): string {
  return safeFilename(value).toLowerCase() || 'chapter';
}
