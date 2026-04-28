export type {
  Act,
  Chapter,
  ChapterStatus,
  Character,
  Location,
  Obstacle,
  ProjectDoc,
  ProjectDocKind,
  StoryStructure
} from '@opentales/sdk';

export type ActivityView =
  | 'explorer'
  | 'characters'
  | 'locations'
  | 'plot'
  | 'outline'
  | 'docs'
  | 'search'
  | 'members'
  | 'inbox'
  | 'problems'
  | 'stats'
  | 'trash'
  | 'ai'
  | 'settings';

export interface OpenTab {
  id: string;
  type:
    | 'chapter'
    | 'character'
    | 'location'
    | 'structure'
    | 'outline'
    | 'submission'
    | 'doc';
  refId: string;
  title: string;
  dirty?: boolean;
}
