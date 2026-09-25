# Export and import

OpenTales has a project-scoped publishing pipeline at `GET /projects/:projectId/exports` and an import preview pipeline at `GET /projects/:projectId/imports`.

Exports can target the canonical manuscript. Supported formats are standard-manuscript DOCX, submission PDF, EPUB 3, a Markdown ZIP bundle, plain text, self-contained HTML, and an OpenTales project archive. Every generated file is stored as a private `Asset` with a SHA-256 checksum, byte size, MIME type, source branch heads, compilation provenance, preset, and status. Downloads use the authenticated project route; private export/import assets deliberately return 404 from the public `/assets/:assetId` route.

Historical compilation exports retain their private assets and provenance for compatibility.

Imports accept DOCX, Markdown, UTF-8 text, sanitized HTML, and OpenTales ZIP/JSON archives. Uploading creates only a preview: parsed chapters, scenes, metadata, and current-project conflicts. Applying the preview is a separate mutation. Conflicts require an explicit confirmation and create new `WritingVersion` rows; a confirmed import does not edit prose in place.

ZIP imports are rejected before extraction when they contain traversal paths, symlinks, duplicate names, encryption, excessive entry counts, excessive uncompressed size, or a suspicious compression ratio. Upload and generated-output size limits are enforced, and failed operations compensate by removing private asset bytes and rows.
