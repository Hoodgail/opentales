-- Project folders provide a path-based file-system surface for docs and selected assets.
CREATE TABLE "ProjectFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectDoc" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "name" TEXT;
ALTER TABLE "Asset" ADD COLUMN "order" INTEGER;

CREATE UNIQUE INDEX "ProjectFolder_projectId_path_key" ON "ProjectFolder"("projectId", "path");
CREATE INDEX "ProjectFolder_projectId_parentFolderId_order_idx" ON "ProjectFolder"("projectId", "parentFolderId", "order");
CREATE INDEX "ProjectFolder_parentFolderId_idx" ON "ProjectFolder"("parentFolderId");
CREATE INDEX "ProjectDoc_folderId_order_idx" ON "ProjectDoc"("folderId", "order");
CREATE INDEX "Asset_folderId_order_idx" ON "Asset"("folderId", "order");

ALTER TABLE "ProjectFolder" ADD CONSTRAINT "ProjectFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFolder" ADD CONSTRAINT "ProjectFolder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "ProjectFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDoc" ADD CONSTRAINT "ProjectDoc_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ProjectFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ProjectFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
