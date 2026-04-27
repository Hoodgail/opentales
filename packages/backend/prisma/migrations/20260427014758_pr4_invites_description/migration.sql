-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "role" "Role" NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE INDEX "Invite_acceptedById_idx" ON "Invite"("acceptedById");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
