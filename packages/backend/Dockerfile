FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/backend packages/backend
COPY packages/sdk packages/sdk
RUN pnpm --dir packages/sdk build
RUN pnpm --dir packages/backend build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/sdk ./packages/sdk
COPY --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/prisma ./packages/backend/prisma
WORKDIR /app/packages/backend
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
