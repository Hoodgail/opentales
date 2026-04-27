-- CreateEnum
CREATE TYPE "CoverOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "coverOrientation" "CoverOrientation" NOT NULL DEFAULT 'LANDSCAPE',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "visibility" "ProjectVisibility" NOT NULL DEFAULT 'PRIVATE';
