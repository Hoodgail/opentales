-- CreateTable
CREATE TABLE "BetaShareLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "chapterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BetaShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaShareComment" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "chapterId" TEXT,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaShareComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaShareLink_token_key" ON "BetaShareLink"("token");

-- CreateIndex
CREATE INDEX "BetaShareLink_projectId_idx" ON "BetaShareLink"("projectId");

-- CreateIndex
CREATE INDEX "BetaShareComment_shareLinkId_createdAt_idx" ON "BetaShareComment"("shareLinkId", "createdAt");

-- AddForeignKey
ALTER TABLE "BetaShareLink" ADD CONSTRAINT "BetaShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaShareLink" ADD CONSTRAINT "BetaShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaShareComment" ADD CONSTRAINT "BetaShareComment_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "BetaShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
