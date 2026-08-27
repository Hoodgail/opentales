export interface ContinuityObservation {
  id: string;
  kind: 'state' | 'knowledge-use' | 'appearance' | 'travel' | 'ownership' | 'setup' | 'payoff' | 'pov' | 'age' | 'thread' | 'scene-boundary' | 'world-rule';
  entityId?: string;
  key?: string;
  value?: unknown;
  order: number;
  metadata?: Record<string, unknown>;
}

export interface ContinuityDiagnostic {
  code: string;
  observationIds: string[];
}

export function analyzeContinuity(observations: ContinuityObservation[]): ContinuityDiagnostic[] {
  const diagnostics: ContinuityDiagnostic[] = [];
  const byOrder = [...observations].sort((a, b) => a.order - b.order);
  const states = new Map<string, ContinuityObservation>();
  const setups = new Map<string, ContinuityObservation>();
  const owners = new Map<string, string>();
  const resolvedThreads = new Set<string>();

  for (const observation of byOrder) {
    const stateKey = `${observation.entityId ?? ''}:${observation.key ?? ''}`;
    if (observation.kind === 'state') {
      const previous = states.get(stateKey);
      if (previous?.order === observation.order && !same(previous.value, observation.value)) diagnostics.push(issue('continuity/conflicting-state', previous, observation));
      states.set(stateKey, observation);
    }
    if (observation.kind === 'knowledge-use') {
      const learnedAt = number(observation.metadata?.learnedAt);
      if (learnedAt !== null && learnedAt > observation.order) diagnostics.push(issue('knowledge/future-leak', observation));
    }
    if (observation.kind === 'appearance') {
      const alive = states.get(`${observation.entityId ?? ''}:alive`);
      if (alive?.value === false && alive.order <= observation.order) diagnostics.push(issue('continuity/dead-character-appears', alive, observation));
    }
    if (observation.kind === 'travel') {
      const distance = number(observation.metadata?.distanceKm);
      const hours = number(observation.metadata?.hours);
      const maxKph = number(observation.metadata?.maxKph);
      if (distance !== null && hours !== null && maxKph !== null && hours * maxKph < distance) diagnostics.push(issue('chronology/impossible-travel', observation));
    }
    if (observation.kind === 'ownership') {
      const item = observation.key ?? '';
      const from = string(observation.metadata?.from);
      const to = string(observation.metadata?.to);
      const current = owners.get(item);
      if (current && from !== current) diagnostics.push(issue('continuity/impossible-transfer', observation));
      if (to) owners.set(item, to);
    }
    if (observation.kind === 'setup' && observation.key) setups.set(observation.key, observation);
    if (observation.kind === 'payoff' && observation.key && !setups.has(observation.key)) diagnostics.push(issue('setup-payoff/payoff-without-setup', observation));
    if (observation.kind === 'payoff' && observation.key) setups.delete(observation.key);
    if (observation.kind === 'pov' && observation.metadata?.allowed === false) diagnostics.push(issue('pov/forbidden-perspective', observation));
    if (observation.kind === 'age') {
      const birthYear = number(observation.metadata?.birthYear);
      const storyYear = number(observation.metadata?.storyYear);
      if (birthYear !== null && storyYear !== null && observation.value !== storyYear - birthYear) diagnostics.push(issue('chronology/age-contradiction', observation));
    }
    if (observation.kind === 'thread' && observation.key) {
      if (observation.metadata?.status === 'resolved') resolvedThreads.add(observation.key);
      const gap = number(observation.metadata?.chaptersSinceLastBeat);
      if (!resolvedThreads.has(observation.key) && gap !== null && gap > 8) diagnostics.push(issue('plot/dormant-thread', observation));
    }
    if (observation.kind === 'scene-boundary' && observation.metadata?.previousOutcome !== observation.metadata?.nextEntryState) diagnostics.push(issue('continuity/scene-boundary-contradiction', observation));
    if (observation.kind === 'world-rule' && observation.metadata?.violated === true) diagnostics.push(issue('world-rule/violation', observation));
  }
  for (const setup of setups.values()) {
    if (setup.metadata?.major === true) diagnostics.push(issue('setup-payoff/unpaid-setup', setup));
  }
  return dedupe(diagnostics);
}

export interface BenchmarkCase {
  id: string;
  observations: ContinuityObservation[];
  expectedCodes: string[];
}

export function gradeContinuityBenchmark(cases: BenchmarkCase[]) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const casesReport = cases.map((fixture) => {
    const actualCodes = new Set(analyzeContinuity(fixture.observations).map((item) => item.code));
    const expectedCodes = new Set(fixture.expectedCodes);
    for (const code of actualCodes) expectedCodes.has(code) ? truePositive += 1 : falsePositive += 1;
    for (const code of expectedCodes) if (!actualCodes.has(code)) falseNegative += 1;
    return { id: fixture.id, expected: [...expectedCodes], actual: [...actualCodes] };
  });
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const falsePositiveRate = falsePositive / Math.max(1, truePositive + falsePositive);
  return { recall, falsePositiveRate, truePositive, falsePositive, falseNegative, cases: casesReport };
}

function issue(code: string, ...observations: ContinuityObservation[]): ContinuityDiagnostic {
  return { code, observationIds: observations.map((item) => item.id) };
}

function dedupe(items: ContinuityDiagnostic[]): ContinuityDiagnostic[] {
  return [...new Map(items.map((item) => [`${item.code}:${item.observationIds.join(',')}`, item])).values()];
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }
