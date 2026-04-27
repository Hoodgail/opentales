import { browser } from '$app/environment';

const STORAGE_KEY = 'opentales.preferences.v1';

export interface PreferencesState {
  /** Daily writing target in words. 0 disables the goal indicator. */
  dailyWordGoal: number;
  /** Words written today, keyed by ISO date (YYYY-MM-DD). */
  dailyProgress: Record<string, number>;
  /** Snapshot of total word counts at midnight (ISO date → total). */
  dailyBaseline: Record<string, number>;
  /** When true, the active line stays vertically centered while writing. */
  typewriterMode: boolean;
  /** When true, all paragraphs except the active one fade. */
  focusMode: boolean;
  /** When true, Monaco's minimap is shown for prose. */
  showMinimap: boolean;
}

function defaultState(): PreferencesState {
  return {
    dailyWordGoal: 500,
    dailyProgress: {},
    dailyBaseline: {},
    typewriterMode: false,
    focusMode: false,
    showMinimap: false
  };
}

function todayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function load(): PreferencesState {
  if (!browser) return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PreferencesState>;
    return {
      ...defaultState(),
      ...parsed,
      dailyProgress: parsed.dailyProgress ?? {},
      dailyBaseline: parsed.dailyBaseline ?? {}
    };
  } catch {
    return defaultState();
  }
}

function persist(state: PreferencesState) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // QuotaExceededError, private mode, etc. — silently ignore.
  }
}

function createPreferences() {
  const state = $state<PreferencesState>(load());

  $effect.root(() => {
    $effect(() => {
      persist(state);
    });
  });

  function setDailyWordGoal(goal: number) {
    state.dailyWordGoal = Math.max(0, Math.floor(goal));
  }

  function setTypewriterMode(value: boolean) {
    state.typewriterMode = value;
  }

  function setFocusMode(value: boolean) {
    state.focusMode = value;
  }

  function setShowMinimap(value: boolean) {
    state.showMinimap = value;
  }

  function recordTotalWords(totalWords: number) {
    const key = todayKey();
    if (state.dailyBaseline[key] === undefined) {
      state.dailyBaseline[key] = totalWords;
    }
    const baseline = state.dailyBaseline[key];
    const written = Math.max(0, totalWords - baseline);
    state.dailyProgress[key] = written;
  }

  function getTodayProgress(): number {
    return state.dailyProgress[todayKey()] ?? 0;
  }

  function streakDays(): number {
    if (state.dailyWordGoal <= 0) return 0;
    let streak = 0;
    const cursor = new Date();
    while (true) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, '0');
      const dd = String(cursor.getDate()).padStart(2, '0');
      const key = `${yyyy}-${mm}-${dd}`;
      const progress = state.dailyProgress[key] ?? 0;
      if (progress >= state.dailyWordGoal) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      // Today not yet hit is fine — break only when a previous day fails.
      if (key === todayKey()) {
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      break;
    }
    return streak;
  }

  return {
    get dailyWordGoal() {
      return state.dailyWordGoal;
    },
    get typewriterMode() {
      return state.typewriterMode;
    },
    get focusMode() {
      return state.focusMode;
    },
    get showMinimap() {
      return state.showMinimap;
    },
    setDailyWordGoal,
    setTypewriterMode,
    setFocusMode,
    setShowMinimap,
    recordTotalWords,
    getTodayProgress,
    streakDays
  };
}

export const preferences = createPreferences();
export type PreferencesStore = ReturnType<typeof createPreferences>;
