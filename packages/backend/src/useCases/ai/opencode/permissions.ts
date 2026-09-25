/**
 * OpenCode permission policy for OpenTales agents.
 *
 * OpenTales tools register under two permission actions:
 * - `opentales.read`  — bounded reads of project data; always allowed.
 * - `opentales.write` — anything that changes project data. The tool itself
 *   raises a permission request with `resources: [toolName]`, so the session
 *   rule decides between asking the author (Manual) and running (Auto).
 *
 * Everything OpenCode ships that touches the host (shell, file edits, reads,
 * web access, code mode, MCP servers) is denied: agents reach the manuscript
 * only through OpenTales tools.
 */

export type PermissionEffect = 'allow' | 'deny' | 'ask';
export interface PermissionRule {
  action: string;
  resource: string;
  effect: PermissionEffect;
}

export const READ_ACTION = 'opentales.read';
export const WRITE_ACTION = 'opentales.write';
export const OPENTALES_PRIMARY_AGENT = 'writer';

export function basePermissions(): PermissionRule[] {
  return [
    { action: '*', resource: '*', effect: 'deny' },
    { action: READ_ACTION, resource: '*', effect: 'allow' },
    { action: WRITE_ACTION, resource: '*', effect: 'ask' },
    { action: 'question', resource: '*', effect: 'allow' },
    { action: 'skill', resource: '*', effect: 'allow' },
    { action: 'subagent', resource: '*', effect: 'allow' }
  ];
}

/** Appended to read-only agents (planner, explore, researcher roles). */
export const READ_ONLY_AGENT_PERMISSIONS: PermissionRule[] = [
  { action: WRITE_ACTION, resource: '*', effect: 'deny' }
];

export type ApprovalMode = 'manual' | 'auto';

/**
 * Session-scoped rules. Manual mode asks before every project change; Auto
 * mode executes permitted changes immediately and removes interactive
 * questions so a run never stalls waiting for the author.
 */
export function sessionPermissions(mode: ApprovalMode): PermissionRule[] {
  return mode === 'auto'
    ? [
        { action: WRITE_ACTION, resource: '*', effect: 'allow' },
        { action: 'question', resource: '*', effect: 'deny' }
      ]
    : [
        { action: WRITE_ACTION, resource: '*', effect: 'ask' },
        { action: 'question', resource: '*', effect: 'allow' }
      ];
}
