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
  | 'build'
  | 'bible'
  | 'publishing'
  | 'revisions'
  | 'outline'
  | 'search'
  | 'members'
  | 'inbox'
  | 'problems'
  | 'stats'
  | 'trash'
  | 'docs'
  | 'ai'
  | 'settings';

export interface OpenTab {
  id: string;
  type:
    | 'chapter'
    | 'character'
    | 'location'
    | 'manuscript'
    | 'build'
    | 'story-bible'
    | 'outline-studio'
    | 'publishing'
    | 'revisions'
    | 'structure'
    | 'outline'
    | 'submission'
    | 'doc'
    | 'ai-skill'
    | 'ai-approval';
  refId: string;
  title: string;
  dirty?: boolean;
}
