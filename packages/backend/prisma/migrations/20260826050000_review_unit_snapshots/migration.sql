ALTER TABLE "BuildReviewUnit"
  ADD COLUMN "reviewedUnitRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewedUnitSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "reviewedUnitSnapshotHash" TEXT NOT NULL DEFAULT '';

-- Existing reviews predate immutable review snapshots and must be recreated before
-- merge. Preserve enough data for inspection while marking the hash as legacy.
UPDATE "BuildReviewUnit" review_unit
SET "reviewedUnitRevision" = unit.revision,
    "reviewedUnitSnapshot" = jsonb_build_object(
      'kind', lower(unit.kind::text), 'key', unit.key, 'parentUnitId', unit."parentUnitId",
      'sourceChapterId', unit."sourceChapterId", 'sourceSceneId', unit."sourceSceneId",
      'order', unit."order", 'chapterNumber', unit."chapterNumber", 'title', unit.title,
      'povCharacterId', unit."povCharacterId", 'locationId', unit."locationId",
      'storyDate', unit."storyDate", 'storyTime', unit."storyTime", 'tension', unit.tension,
      'metadata', unit.metadata, 'branchId', unit."branchId"
    ),
    "reviewedUnitSnapshotHash" = 'legacy-review-recreate-required'
FROM "BuildManuscriptUnit" unit
WHERE unit.id = review_unit."unitId";
