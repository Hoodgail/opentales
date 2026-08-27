ALTER TABLE "BuildReviewUnit" ADD COLUMN "reviewedContentHash" TEXT NOT NULL DEFAULT '';
UPDATE "BuildReviewUnit" review_unit
SET "reviewedContentHash" = compilation_unit."contentHash"
FROM "BuildReview" review
JOIN "BuildCompilationUnit" compilation_unit ON compilation_unit."compilationId" = review."compilationId"
WHERE review.id = review_unit."reviewId" AND compilation_unit."unitId" = review_unit."unitId";
