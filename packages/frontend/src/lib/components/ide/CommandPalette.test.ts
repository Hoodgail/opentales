import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { commandPalette } from '$lib/stores/commandPalette.svelte';
import { manuscript } from '$lib/stores/manuscript.svelte';
import { storyUi } from '$lib/stores/storyUi.svelte';
import CommandPalette from './CommandPalette.svelte';

describe('CommandPalette accessibility', () => {
  afterEach(() => {
    commandPalette.hide();
    storyUi.clearRenameSymbolRequest();
    const index = manuscript.characters.findIndex((character) => character.id === 'rename-character');
    if (index >= 0) manuscript.characters.splice(index, 1);
    void manuscript.setSelectedId(null);
    cleanup();
  });

  it('exposes combobox options, traps focus, and restores the trigger', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.append(trigger);
    trigger.focus();
    render(CommandPalette);
    commandPalette.show();

    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);

    await fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    await fireEvent.keyDown(document.activeElement ?? input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it('exposes manuscript export and import commands', async () => {
    render(CommandPalette);
    commandPalette.show();
    const input = await screen.findByRole('combobox');
    await fireEvent.input(input, { target: { value: 'export manuscript' } });
    expect(await screen.findByRole('option', { name: /Export manuscript/ })).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'import manuscript' } });
    expect(await screen.findByRole('option', { name: /Import manuscript/ })).toBeTruthy();
  });

  it('offers Rename symbol for the selected story entity and opens the refactor request', async () => {
    manuscript.characters.push({
      id: 'rename-character', name: 'Mara', role: 'Protagonist', age: '', occupation: '', description: '',
      appearance: '', motivation: '', arc: '', traits: [], aliases: ['The Fox'], relationships: [], assets: []
    });
    await manuscript.setSelectedId('rename-character');
    render(CommandPalette);
    commandPalette.show();
    const input = await screen.findByRole('combobox');
    await fireEvent.input(input, { target: { value: 'rename symbol' } });
    const option = await screen.findByRole('option', { name: /Rename symbol/ });
    expect(option.textContent).toContain('Mara');
    await fireEvent.click(option);

    await waitFor(() => expect(storyUi.renameSymbolRequest).toMatchObject({
      targetType: 'character', targetId: 'rename-character', name: 'Mara', aliases: ['The Fox']
    }));
  });
});
