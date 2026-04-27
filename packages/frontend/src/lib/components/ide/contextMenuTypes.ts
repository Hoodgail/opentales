import type { ComponentType, SvelteComponent } from 'svelte';

// Lucide-svelte (and several of our other icon imports) export legacy
// SvelteComponent classes. ComponentType<SvelteComponent> covers them
// without forcing every consumer to import a specific icon's type.
export type IconComponent = ComponentType<SvelteComponent>;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: IconComponent;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}
