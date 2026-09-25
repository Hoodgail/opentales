import path from 'node:path';

/**
 * Filesystem layout for the embedded OpenCode host.
 *
 * Everything lives below `OPENCODE_DATA_DIR` (default `./data/opencode`):
 *
 * - `home/`         isolated HOME and XDG roots so the host never reads the
 *                   server operator's `~/.claude`, `~/.config/opencode`, MCP
 *                   servers, or skills.
 * - `opencode.db`   OpenCode's session/message/event store.
 * - `projects/<id>` one generated workspace per OpenTales project. Its
 *                   `.opencode/` directory holds the project's opencode.json,
 *                   agents, and skills. No manuscript data is written here;
 *                   the agent reaches project data only through OpenTales tools.
 */
export const opencodeRoot = path.resolve(process.env.OPENCODE_DATA_DIR ?? './data/opencode');
export const opencodeHome = path.join(opencodeRoot, 'home');
export const opencodeDatabasePath = path.join(opencodeRoot, 'opencode.db');
export const opencodeProjectsRoot = path.join(opencodeRoot, 'projects');

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function projectWorkspaceDirectory(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error('Invalid project id for agent workspace');
  return path.join(opencodeProjectsRoot, projectId);
}

/** Inverse of projectWorkspaceDirectory; returns null for foreign directories. */
export function projectIdFromWorkspace(directory: string): string | null {
  const relative = path.relative(opencodeProjectsRoot, path.resolve(directory));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [projectId] = relative.split(path.sep);
  return projectId && PROJECT_ID_PATTERN.test(projectId) ? projectId : null;
}

/**
 * Point every XDG/HOME lookup at the isolated home. Must run before
 * `@opencode/util` is imported because it resolves roots at module load.
 */
export function isolateOpencodeEnvironment(): void {
  process.env.OPENCODE_TEST_HOME = path.join(opencodeHome, 'user');
  process.env.XDG_DATA_HOME = path.join(opencodeHome, 'data');
  process.env.XDG_CACHE_HOME = path.join(opencodeHome, 'cache');
  process.env.XDG_CONFIG_HOME = path.join(opencodeHome, 'config');
  process.env.XDG_STATE_HOME = path.join(opencodeHome, 'state');
  process.env.OPENCODE_CONFIG_DIR = path.join(opencodeHome, 'config', 'opencode');
}
