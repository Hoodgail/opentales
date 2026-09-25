# Dokploy deployment

Deploy the repository as a Docker Compose application using `docker-compose.yml`.
Both images use Node 24, matching CI and providing OpenCode's `node:sqlite`
runtime. No Bun process or separate OpenCode server is needed.

Set these variables in Dokploy before building:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL reachable from the backend container; provision PostgreSQL separately. |
| `JWT_SECRET` | A long, random secret, kept stable across deployments. |
| `WEB_HOST` | Frontend hostname without a scheme; defaults to `opentales.hoodgail.me`. |
| `API_HOST` | Backend hostname without a scheme; defaults to `opentales-api.hoodgail.me`. |
| `VITE_API_URL` | Public backend URL, including `https://`; defaults to `https://opentales-api.hoodgail.me`. This is baked into the frontend at build time. |
| `CORS_ORIGIN` | Public frontend origin; defaults to `https://opentales.hoodgail.me`. |
| `PUBLIC_BASE_URL` | Public backend URL; defaults to `https://opentales-api.hoodgail.me`. |
| `MCP_PUBLIC_URL` | Public frontend URL plus `/mcp`. |
| `MCP_OAUTH_ISSUER` | Public frontend URL. |
| `MCP_ALLOWED_ORIGINS` | Comma-separated frontend and permitted MCP client origins. |

When changing hostnames, update the corresponding URL/origin variables together.
The repository's Traefik labels route HTTP on the `web` entrypoint. Configure
HTTPS certificates and routing in Dokploy for the frontend (port 80) and backend
(port 4000); the HTTPS URL defaults assume that TLS setup. Dokploy must provide
the external `dokploy-network`. Both services also share a private Compose network
for the frontend's MCP/OAuth proxy.

The backend runs `prisma migrate deploy` before starting. A failed migration or
unreachable database prevents startup. `/health` on each service checks HTTP
availability; it does not exercise a model provider.

Agent history lives in the `opencode-data` named volume, mounted at
`/app/data/opencode`. Keep the Compose project identity stable across redeploys
so the same volume is reused. Back up this volume alongside PostgreSQL; removing
it (including with `docker compose down -v`) deletes agent sessions. Each
deployment must use a single backend replica with this embedded SQLite store.
Local `.env` files, generated output, dependencies, and agent data are excluded
from the Docker build context.

CI builds both production images, checks the backend's migrations and HTTP
startup, and creates then reads an OpenCode session in two fresh containers
sharing one volume. These checks require no provider credentials. Live model
requests still depend on the project's provider settings and network access.
