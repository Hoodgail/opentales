-- BuildReviewUnit is owned jointly by its review and immutable build unit. Cascading
-- either parent is safe and prevents project/build deletion ordering from tripping a
-- restrictive FK while the sibling cascade is still in progress.
ALTER TABLE "BuildReviewUnit" DROP CONSTRAINT "BuildReviewUnit_unitId_fkey";
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
