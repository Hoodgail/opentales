-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'FINAL');

-- CreateEnum
CREATE TYPE "ObstacleType" AS ENUM ('INTERNAL', 'EXTERNAL', 'INTERPERSONAL');

-- CreateEnum
CREATE TYPE "WritingKind" AS ENUM ('CHAPTER_BODY', 'SCENE_BODY', 'LOGLINE', 'OUTLINE', 'CLIMAX', 'CHARACTER_DESCRIPTION', 'CHARACTER_APPEARANCE', 'CHARACTER_MOTIVATION', 'CHARACTER_ARC', 'LOCATION_DESCRIPTION', 'LOCATION_ATMOSPHERE', 'LOCATION_SIGNIFICANCE', 'LOCATION_SENSORY', 'OBSTACLE_DESCRIPTION', 'OBSTACLE_RESOLUTION', 'NOTE');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEXT_BLOB');

-- CreateEnum
CREATE TYPE "AttachmentEntity" AS ENUM ('CHARACTER', 'LOCATION', 'CHAPTER', 'SCENE', 'PROJECT', 'WRITING_VERSION', 'USER');

-- CreateEnum
CREATE TYPE "TabKind" AS ENUM ('CHAPTER', 'SCENE', 'CHARACTER', 'LOCATION', 'STRUCTURE', 'OUTLINE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "avatarAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT,
    "perspective" TEXT,
    "pov" TEXT,
    "voice" TEXT,
    "tone" TEXT,
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryStructure" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "loglineWritingId" TEXT NOT NULL,
    "outlineWritingId" TEXT NOT NULL,
    "climaxWritingId" TEXT NOT NULL,

    CONSTRAINT "StoryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "age" TEXT,
    "occupation" TEXT,
    "traits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatarAssetId" TEXT,
    "descriptionWritingId" TEXT NOT NULL,
    "appearanceWritingId" TEXT NOT NULL,
    "motivationWritingId" TEXT NOT NULL,
    "arcWritingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterRelationship" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromCharacterId" TEXT NOT NULL,
    "toCharacterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "CharacterRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "imageAssetId" TEXT,
    "descriptionWritingId" TEXT NOT NULL,
    "atmosphereWritingId" TEXT NOT NULL,
    "significanceWritingId" TEXT NOT NULL,
    "sensoryWritingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Act" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChapterStatus" NOT NULL DEFAULT 'DRAFT',
    "povCharacterId" TEXT,
    "locationId" TEXT,
    "summary" TEXT,
    "bodyWritingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "povCharacterId" TEXT,
    "locationId" TEXT,
    "bodyWritingId" TEXT NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obstacle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ObstacleType" NOT NULL,
    "descriptionWritingId" TEXT NOT NULL,
    "resolutionWritingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Obstacle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Writing" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "WritingKind" NOT NULL,
    "defaultBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Writing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingBranch" (
    "id" TEXT NOT NULL,
    "writingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentBranchId" TEXT,
    "headVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingVersion" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "body" TEXT,
    "bodyAssetId" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAttachment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "entityType" "AttachmentEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "order" INTEGER,

    CONSTRAINT "AssetAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProjectState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activeView" TEXT,
    "activeTabId" TEXT,
    "selectedRefType" TEXT,
    "selectedRefId" TEXT,

    CONSTRAINT "UserProjectState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenTab" (
    "id" TEXT NOT NULL,
    "userProjectStateId" TEXT NOT NULL,
    "kind" "TabKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dirty" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,

    CONSTRAINT "OpenTab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_slug_key" ON "Project"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "StoryStructure_projectId_key" ON "StoryStructure"("projectId");

-- CreateIndex
CREATE INDEX "Character_projectId_idx" ON "Character"("projectId");

-- CreateIndex
CREATE INDEX "CharacterRelationship_projectId_idx" ON "CharacterRelationship"("projectId");

-- CreateIndex
CREATE INDEX "CharacterRelationship_toCharacterId_idx" ON "CharacterRelationship"("toCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterRelationship_fromCharacterId_toCharacterId_type_key" ON "CharacterRelationship"("fromCharacterId", "toCharacterId", "type");

-- CreateIndex
CREATE INDEX "Location_projectId_idx" ON "Location"("projectId");

-- CreateIndex
CREATE INDEX "Act_projectId_idx" ON "Act"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Act_projectId_order_key" ON "Act"("projectId", "order");

-- CreateIndex
CREATE INDEX "Chapter_projectId_idx" ON "Chapter"("projectId");

-- CreateIndex
CREATE INDEX "Chapter_actId_order_idx" ON "Chapter"("actId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_projectId_number_key" ON "Chapter"("projectId", "number");

-- CreateIndex
CREATE INDEX "Scene_chapterId_idx" ON "Scene"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_chapterId_order_key" ON "Scene"("chapterId", "order");

-- CreateIndex
CREATE INDEX "Obstacle_projectId_idx" ON "Obstacle"("projectId");

-- CreateIndex
CREATE INDEX "Writing_projectId_kind_idx" ON "Writing"("projectId", "kind");

-- CreateIndex
CREATE INDEX "WritingBranch_parentBranchId_idx" ON "WritingBranch"("parentBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "WritingBranch_writingId_name_key" ON "WritingBranch"("writingId", "name");

-- CreateIndex
CREATE INDEX "WritingVersion_branchId_idx" ON "WritingVersion"("branchId");

-- CreateIndex
CREATE INDEX "WritingVersion_parentVersionId_idx" ON "WritingVersion"("parentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_s3Key_key" ON "Asset"("s3Key");

-- CreateIndex
CREATE INDEX "Asset_projectId_kind_idx" ON "Asset"("projectId", "kind");

-- CreateIndex
CREATE INDEX "AssetAttachment_entityType_entityId_idx" ON "AssetAttachment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetAttachment_entityType_entityId_role_assetId_key" ON "AssetAttachment"("entityType", "entityId", "role", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProjectState_userId_projectId_key" ON "UserProjectState"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStructure" ADD CONSTRAINT "StoryStructure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStructure" ADD CONSTRAINT "StoryStructure_loglineWritingId_fkey" FOREIGN KEY ("loglineWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStructure" ADD CONSTRAINT "StoryStructure_outlineWritingId_fkey" FOREIGN KEY ("outlineWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStructure" ADD CONSTRAINT "StoryStructure_climaxWritingId_fkey" FOREIGN KEY ("climaxWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_descriptionWritingId_fkey" FOREIGN KEY ("descriptionWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_appearanceWritingId_fkey" FOREIGN KEY ("appearanceWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_motivationWritingId_fkey" FOREIGN KEY ("motivationWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_arcWritingId_fkey" FOREIGN KEY ("arcWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelationship" ADD CONSTRAINT "CharacterRelationship_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelationship" ADD CONSTRAINT "CharacterRelationship_fromCharacterId_fkey" FOREIGN KEY ("fromCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterRelationship" ADD CONSTRAINT "CharacterRelationship_toCharacterId_fkey" FOREIGN KEY ("toCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_descriptionWritingId_fkey" FOREIGN KEY ("descriptionWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_atmosphereWritingId_fkey" FOREIGN KEY ("atmosphereWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_significanceWritingId_fkey" FOREIGN KEY ("significanceWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_sensoryWritingId_fkey" FOREIGN KEY ("sensoryWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_povCharacterId_fkey" FOREIGN KEY ("povCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_bodyWritingId_fkey" FOREIGN KEY ("bodyWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_povCharacterId_fkey" FOREIGN KEY ("povCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_bodyWritingId_fkey" FOREIGN KEY ("bodyWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obstacle" ADD CONSTRAINT "Obstacle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obstacle" ADD CONSTRAINT "Obstacle_descriptionWritingId_fkey" FOREIGN KEY ("descriptionWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obstacle" ADD CONSTRAINT "Obstacle_resolutionWritingId_fkey" FOREIGN KEY ("resolutionWritingId") REFERENCES "Writing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Writing" ADD CONSTRAINT "Writing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Writing" ADD CONSTRAINT "Writing_defaultBranchId_fkey" FOREIGN KEY ("defaultBranchId") REFERENCES "WritingBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingBranch" ADD CONSTRAINT "WritingBranch_writingId_fkey" FOREIGN KEY ("writingId") REFERENCES "Writing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingBranch" ADD CONSTRAINT "WritingBranch_parentBranchId_fkey" FOREIGN KEY ("parentBranchId") REFERENCES "WritingBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingBranch" ADD CONSTRAINT "WritingBranch_headVersionId_fkey" FOREIGN KEY ("headVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingVersion" ADD CONSTRAINT "WritingVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WritingBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingVersion" ADD CONSTRAINT "WritingVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingVersion" ADD CONSTRAINT "WritingVersion_bodyAssetId_fkey" FOREIGN KEY ("bodyAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingVersion" ADD CONSTRAINT "WritingVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAttachment" ADD CONSTRAINT "AssetAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectState" ADD CONSTRAINT "UserProjectState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectState" ADD CONSTRAINT "UserProjectState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTab" ADD CONSTRAINT "OpenTab_userProjectStateId_fkey" FOREIGN KEY ("userProjectStateId") REFERENCES "UserProjectState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
