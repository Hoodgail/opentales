import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'OWNER' as 'OWNER' | 'VIEWER' | null }));
const mocks = vi.hoisted(() => ({
  loadMembers: vi.fn(async () => undefined),
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({
    key: {
      id: 'key-1',
      projectId: 'project-1',
      name: 'My writing agent',
      permission: 'read-write' as const,
      prefix: 'otmcp_abcd1234',
      expiresAt: '2027-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-08-28T00:00:00.000Z'
    },
    secret: `otmcp_${'a'.repeat(43)}`
  })),
  revoke: vi.fn(async () => null)
}));

vi.mock('$lib/stores/manuscript.svelte', () => ({
  manuscript: {
    projectId: 'project-1',
    get currentUserRole() { return state.role; },
    membersLoading: false,
    error: null,
    loadMembers: mocks.loadMembers,
    listProjectMcpApiKeys: mocks.list,
    createProjectMcpApiKey: mocks.create,
    revokeProjectMcpApiKey: mocks.revoke
  }
}));

const { default: McpApiKeysSection } = await import('./McpApiKeysSection.svelte');

beforeEach(() => {
  state.role = 'OWNER';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('McpApiKeysSection', () => {
  it('creates a scoped key and renders copy-ready Codex and Claude setup', async () => {
    render(McpApiKeysSection);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    await screen.findByText('Copy this key now');
    expect(screen.getByText(`otmcp_${'a'.repeat(43)}`)).toBeTruthy();
    expect(screen.getByText(/codex mcp add opentales/)).toBeTruthy();
    expect(screen.getByText(/claude mcp add --transport http/)).toBeTruthy();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My writing agent',
      permission: 'read-write'
    }));
  });

  it('does not expose key management to viewers', () => {
    state.role = 'VIEWER';
    render(McpApiKeysSection);
    expect(screen.getByText(/Owner or admin permission is required/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
