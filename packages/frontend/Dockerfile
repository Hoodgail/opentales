FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/backend/package.json packages/backend/package.json
RUN pnpm install --frozen-lockfile
COPY packages/frontend packages/frontend
COPY packages/sdk packages/sdk
ARG VITE_API_URL=https://opentales-api.lumina.pw
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --dir packages/frontend build

FROM nginx:1.27-alpine AS runtime
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/build /usr/share/nginx/html
EXPOSE 80
