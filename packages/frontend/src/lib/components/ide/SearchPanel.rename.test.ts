import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { manuscript } from '$lib/stores/manuscript.svelte';
import { storyIde } from '$lib/stores/storyIde.svelte';
import { storyUi } from '$lib/stores/storyUi.svelte';
import SearchPanel from './SearchPanel.svelte';

describe('SearchPanel symbol refactors', () => {
  afterEach(() => {
    storyUi.clearReferenceRequest();
    storyUi.clearRenameSymbolRequest();
    storyIde.reset();
    const characterIndex = manuscript.characters.findIndex((character) => character.id === 'search-character');
    if (characterIndex >= 0) manuscript.characters.splice(characterIndex, 1);
    const locationIndex = manuscript.locations.findIndex((location) => location.id === 'search-location');
    if (locationIndex >= 0) manuscript.locations.splice(locationIndex, 1);
    cleanup();
  });

  it('starts rename from a selected character reference target', async () => {
    manuscript.characters.push({
      id: 'search-character', name: 'Mara', role: 'Protagonist', age: '', occupation: '', description: '',
      appearance: '', motivation: '', arc: '', traits: [], aliases: ['The Fox'], relationships: [], assets: []
    });
    storyUi.requestReferences('character', 'search-character', 'Mara');
    render(SearchPanel);

    await fireEvent.click(await screen.findByRole('button', { name: 'Rename Mara' }));
    await waitFor(() => expect(storyUi.renameSymbolRequest).toMatchObject({
      targetType: 'character', targetId: 'search-character', name: 'Mara', aliases: ['The Fox']
    }));
  });

  it('starts rename from a selected location reference target', async () => {
    manuscript.locations.push({
      id: 'search-location', name: 'North Station', aliases: ['The Terminus'], type: 'Transit',
      description: '', atmosphere: '', significance: '', sensoryDetails: ''
    });
    storyUi.requestReferences('location', 'search-location', 'North Station');
    render(SearchPanel);

    await fireEvent.click(await screen.findByRole('button', { name: 'Rename North Station' }));
    await waitFor(() => expect(storyUi.renameSymbolRequest).toMatchObject({
      targetType: 'location', targetId: 'search-location', name: 'North Station', aliases: ['The Terminus']
    }));
  });
});
