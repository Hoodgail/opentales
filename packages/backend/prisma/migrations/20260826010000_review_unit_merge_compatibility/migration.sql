-- Review targets are nullable foreign keys so project/chapter/scene deletion can
-- cascade safely. Their kind/action consistency is validated atomically by the
-- BuildManuscript use case while holding the review and target writing locks.
ALTER TABLE "BuildReviewUnit" DROP CONSTRAINT IF EXISTS "BuildReviewUnit_target_check";
