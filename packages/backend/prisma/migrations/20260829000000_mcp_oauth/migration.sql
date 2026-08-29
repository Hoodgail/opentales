-- CreateTable
CREATE TABLE "McpOAuthClient" (
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "responseTypes" TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "clientUri" TEXT,
    "logoUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "McpOAuthAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "ProjectMcpApiKeyPermission" NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthToken" (
    "id" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "ProjectMcpApiKeyPermission" NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[],
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpOAuthClient_createdAt_idx" ON "McpOAuthClient"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthAuthorizationCode_codeHash_key" ON "McpOAuthAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "McpOAuthAuthorizationCode_clientId_expiresAt_idx" ON "McpOAuthAuthorizationCode"("clientId", "expiresAt");

-- CreateIndex
CREATE INDEX "McpOAuthAuthorizationCode_projectId_userId_idx" ON "McpOAuthAuthorizationCode"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthToken_accessTokenHash_key" ON "McpOAuthToken"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthToken_refreshTokenHash_key" ON "McpOAuthToken"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "McpOAuthToken_clientId_revokedAt_idx" ON "McpOAuthToken"("clientId", "revokedAt");

-- CreateIndex
CREATE INDEX "McpOAuthToken_projectId_userId_idx" ON "McpOAuthToken"("projectId", "userId");

-- CreateIndex
CREATE INDEX "McpOAuthToken_refreshExpiresAt_idx" ON "McpOAuthToken"("refreshExpiresAt");

-- AddForeignKey
ALTER TABLE "McpOAuthAuthorizationCode" ADD CONSTRAINT "McpOAuthAuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthAuthorizationCode" ADD CONSTRAINT "McpOAuthAuthorizationCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthAuthorizationCode" ADD CONSTRAINT "McpOAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
