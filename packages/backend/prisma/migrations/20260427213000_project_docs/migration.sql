-- CreateEnum
CREATE TYPE "ProjectDocKind" AS ENUM ('NOTE', 'BRAINSTORM', 'INSTRUCTIONS', 'REFERENCE', 'OTHER');

-- CreateTable
CREATE TABLE "ProjectDoc" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ProjectDocKind" NOT NULL DEFAULT 'NOTE',
    "bodyWritingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDoc_projectId_order_idx" ON "ProjectDoc"("projectId", "order");

-- CreateIndex
CREATE INDEX "ProjectDoc_projectId_kind_idx" ON "ProjectDoc"("projectId", "kind");

-- AddForeignKey
ALTER TABLE "ProjectDoc" ADD CONSTRAINT "ProjectDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDoc" ADD CONSTRAINT "ProjectDoc_bodyWritingId_fkey" FOREIGN KEY ("bodyWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
