export type {
  Act,
  Chapter,
  ChapterStatus,
  Character,
  Location,
  Obstacle,
  StoryStructure
} from '@opentales/sdk';

export type ActivityView =
  | 'explorer'
  | 'characters'
  | 'locations'
  | 'plot'
  | 'outline'
  | 'search'
  | 'members'
  | 'inbox'
  | 'problems'
  | 'stats'
  | 'trash'
  | 'settings';

export interface OpenTab {
  id: string;
  type: 'chapter' | 'character' | 'location' | 'structure' | 'outline' | 'submission';
  refId: string;
  title: string;
  dirty?: boolean;
}
