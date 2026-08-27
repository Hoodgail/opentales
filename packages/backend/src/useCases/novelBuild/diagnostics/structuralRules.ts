import type {
  CanonFact,
  EntityState,
  JsonObject,
  JsonValue,
  StoryArtifact,
  StoryReference,
  StorySourceSpan
} from '@opentales/sdk';
import { validateArtifactContent } from '../schemas.js';
import {
  artifactEvidence,
  chapterEvidence,
  chapterReference,
  escapeRegex,
  findEvidence,
  flattenJson,
  groupBy,
  hasCycle,
  isJsonObject,
  isManuscriptComplete,
  isMetadataEnforced,
  jsonString,
  median,
  normalizeText,
  pairs,
  parseChronology,
  parseSceneTimestamp,
  proseUnits,
  reference,
  sceneEvidence,
  sceneReference,
  sourceEvidence,
  stableStringify,
  stringArray,
  uniqueBy,
  wordCount
} from './internal.js';
import type {
  DiagnosticContext,
  DiagnosticKnowledgeClaim,
  DiagnosticKnowledgeDelta,
  DiagnosticSceneSnapshot,
  StoryDiagnosticsInput,
  TravelTimeRule
} from './types.js';

export function runStructuralRules(context: DiagnosticContext): void {
  runArtifactIntegrityRules(context);
  runReferenceIntegrityRules(context);
  runCanonContinuityRules(context);
  runEntityStateRules(context);
  runAppearanceContinuityRules(context);
  runChronologyRules(context);
  runLocationRules(context);
  runKnowledgeRules(context);
  runWorldRuleRules(context);
  runCharacterRules(context);
  runPovRules(context);
  runSetupPayoffRules(context);
  runPlotRules(context);
  runPacingRules(context);
  runMetadataRules(context);
  runPublishingRules(context);
}

function runArtifactIntegrityRules(context: DiagnosticContext): void {
  for (const artifact of context.activeArtifacts) {
    try {
      validateArtifactContent(artifact.type, artifact.content);
    } catch (error) {
      context.add({
        code: 'schema-invalid',
        category: 'schema',
        severity: 'error',
        message: `Artifact “${artifact.title}” does not satisfy ${artifact.schemaVersion}: ${
          error instanceof Error ? error.message : 'unknown schema error'
        }`,
        evidence: [artifactEvidence(artifact.id)],
        relatedRefs: [reference('artifact', artifact.id, artifact.key, artifact.title)],
        suggestedResolution: 'Repair the artifact content against its declared schema before using it downstream.'
      });
    }
  }

  const duplicateArtifactKeys = groupBy(
    context.activeArtifacts,
    (artifact) => `${artifact.type}:${artifact.key}`
  );
  for (const artifacts of duplicateArtifactKeys.values()) {
    if (artifacts.length < 2) continue;
    context.add({
      code: 'duplicate-artifact-key',
      category: 'schema',
      severity: 'error',
      message: `${artifacts.length} active ${artifacts[0].type} artifacts share key “${artifacts[0].key}”.`,
      evidence: artifacts.map((artifact) => artifactEvidence(artifact.id)),
      relatedRefs: artifacts.map((artifact) =>
        reference('artifact', artifact.id, artifact.key, artifact.title)
      ),
      suggestedResolution: 'Supersede or invalidate all but the intended current artifact.'
    });
  }
}

function runReferenceIntegrityRules(context: DiagnosticContext): void {
  const chapterKeys = new Set(
    context.activeArtifacts
      .filter((artifact) => artifact.type === 'chapter-brief' && isJsonObject(artifact.content))
      .map((artifact) => String((artifact.content as JsonObject).chapterKey ?? artifact.key))
  );
  const scenePlans = context.activeArtifacts.filter(
    (artifact) => artifact.type === 'scene-plan' && isJsonObject(artifact.content)
  );
  const sceneKeys = new Set(
    scenePlans.map((artifact) => String((artifact.content as JsonObject).sceneKey ?? artifact.key))
  );

  for (const artifact of scenePlans) {
    const content = artifact.content as JsonObject;
    const chapterKey = jsonString(content.chapterKey) ?? '';
    if (chapterKey && !chapterKeys.has(chapterKey)) {
      context.add({
        code: 'missing-chapter-brief',
        category: 'cross-link',
        severity: 'error',
        message: `Scene plan “${artifact.title}” references missing chapter brief “${chapterKey}”.`,
        evidence: [artifactEvidence(artifact.id)],
        relatedRefs: [reference('artifact', artifact.id, artifact.key, artifact.title)],
        suggestedResolution: 'Create the chapter brief or relink the scene plan to an active chapter.'
      });
    }
    for (const dependency of stringArray(content.dependencies)) {
      if (sceneKeys.has(dependency)) continue;
      context.add({
        code: 'missing-scene-dependency',
        category: 'cross-link',
        severity: 'error',
        message: `Scene plan “${artifact.title}” depends on missing scene “${dependency}”.`,
        evidence: [artifactEvidence(artifact.id)],
        relatedRefs: [reference('artifact', artifact.id, artifact.key, artifact.title)],
        suggestedResolution: 'Restore the dependency or remove the stale dependency key.'
      });
    }
  }

  const checkSceneLink = (
    ownerType: string,
    ownerId: string,
    ownerKey: string,
    field: string,
    sceneId: string | null
  ) => {
    if (!sceneId || context.sceneById.has(sceneId)) return;
    context.add({
      code: 'missing-story-state-scene',
      category: 'cross-link',
      severity: 'error',
      message: `${ownerType} “${ownerKey}” references missing ${field} scene “${sceneId}”.`,
      evidence: [],
      relatedRefs: [reference(ownerType, ownerId, ownerKey), reference('scene', sceneId)],
      suggestedResolution: 'Relink the record to a scene on this build branch or invalidate the stale record.'
    });
  };

  for (const fact of context.input.canonFacts.filter((value) => value.isCurrent && value.invalidatedAt === null)) {
    checkSceneLink('canon-fact', fact.id, fact.key, 'valid-from', fact.validFromSceneId);
    checkSceneLink('canon-fact', fact.id, fact.key, 'valid-to', fact.validToSceneId);
    checkSceneLink('canon-fact', fact.id, fact.key, 'source', fact.sourceSceneId);
  }
  for (const state of context.input.entityStates.filter((value) => value.isCurrent && value.invalidatedAt === null)) {
    checkSceneLink('entity-state', state.id, state.key, 'valid-from', state.validFromSceneId);
    checkSceneLink('entity-state', state.id, state.key, 'valid-to', state.validToSceneId);
  }
  for (const setup of context.input.setupPayoffs.filter((value) => value.isCurrent && value.invalidatedAt === null)) {
    checkSceneLink('setup-payoff', setup.id, setup.key, 'setup', setup.setupSceneId);
    checkSceneLink('setup-payoff', setup.id, setup.key, 'payoff', setup.payoffSceneId);
    for (const sceneId of setup.reinforcementSceneIds) {
      checkSceneLink('setup-payoff', setup.id, setup.key, 'reinforcement', sceneId);
    }
  }
  for (const loop of context.input.openLoops.filter((value) => value.isCurrent && value.invalidatedAt === null)) {
    checkSceneLink('open-loop', loop.id, loop.key, 'introduction', loop.introducedSceneId);
    checkSceneLink('open-loop', loop.id, loop.key, 'resolution', loop.resolvedSceneId);
  }
  for (const thread of context.input.plotThreads.filter((value) => value.isCurrent && value.invalidatedAt === null)) {
    for (const sceneId of thread.sceneIds) {
      checkSceneLink('plot-thread', thread.id, thread.key, 'thread', sceneId);
    }
  }
}

function runCanonContinuityRules(context: DiagnosticContext): void {
  const canonical = context.input.canonFacts.filter(
    (fact) => fact.isCurrent && fact.status === 'canonical' && fact.invalidatedAt === null
  );
  const slots = groupBy(
    canonical,
    (fact) => `${normalizeKey(fact.subjectType)}:${fact.subjectId}:${normalizeKey(fact.predicate)}`
  );

  for (const facts of slots.values()) {
    const conflicting = pairs(facts).filter(
      ([left, right]) =>
        stableStringify(left.object) !== stableStringify(right.object) &&
        intervalsOverlap(factInterval(left, context), factInterval(right, context))
    );
    if (conflicting.length === 0) continue;
    const involved = uniqueBy(conflicting.flat(), (fact) => fact.id);
    const first = involved[0];
    const category = /world|rule|magic|technology/.test(normalizeKey(first.subjectType))
      ? 'world-rule'
      : 'continuity';
    context.add({
      code: category === 'world-rule' ? 'world-rule-canon-conflict' : 'canon-conflict',
      category,
      severity: 'error',
      message: `Conflicting canonical values overlap for ${first.subjectType}:${first.subjectId}.${first.predicate}.`,
      evidence: involved.flatMap((fact) => {
        const evidence = sourceEvidence(fact);
        return evidence ? [evidence] : [];
      }),
      relatedRefs: involved.map((fact) => reference('canon-fact', fact.id, fact.key)),
      suggestedResolution: 'Reconcile the values or close the earlier fact’s validity interval.'
    });
  }
}

function runEntityStateRules(context: DiagnosticContext): void {
  const activeStates = context.input.entityStates.filter(
    (state) => state.isCurrent && state.status === 'active' && state.invalidatedAt === null
  );
  const slots = groupBy(
    activeStates,
    (state) => `${normalizeKey(state.entityType)}:${state.entityId}:${normalizeKey(state.stateKey)}`
  );

  for (const states of slots.values()) {
    const conflicting = pairs(states).filter(
      ([left, right]) =>
        stableStringify(left.value) !== stableStringify(right.value) &&
        intervalsOverlap(stateInterval(left, context), stateInterval(right, context))
    );
    if (conflicting.length === 0) continue;
    const involved = uniqueBy(conflicting.flat(), (state) => state.id);
    const first = involved[0];
    const locationState = /location|place|whereabouts/.test(normalizeKey(first.stateKey));
    context.add({
      code: locationState ? 'location-state-conflict' : 'entity-state-conflict',
      category: locationState ? 'location' : 'continuity',
      severity: 'error',
      message: `${first.entityType} “${first.entityId}” has overlapping, incompatible “${first.stateKey}” states.`,
      evidence: involved.flatMap((state) => {
        const evidence = sourceEvidence(state);
        return evidence ? [evidence] : [];
      }),
      relatedRefs: involved.map((state) => reference('entity-state', state.id, state.key)),
      suggestedResolution: 'Close the prior state interval or reconcile the state values.'
    });
  }

  runObjectTransferContinuityRules(context, activeStates);

  if (context.input.projectRules?.allowResurrection) return;
  const lifeStates = activeStates.filter(
    (state) =>
      /character|person/.test(normalizeKey(state.entityType)) &&
      /alive|dead|life-status|status/.test(normalizeKey(state.stateKey))
  );
  for (const scene of context.scenes) {
    const storyOrder = context.sceneOrder.get(scene.id) ?? -1;
    for (const characterId of uniqueBy(
      [...scene.characterPresentIds, ...(scene.povCharacterId ? [scene.povCharacterId] : [])],
      (value) => value
    )) {
      const current = currentStateAt(
        lifeStates.filter((state) => state.entityId === characterId),
        storyOrder,
        context
      );
      if (!current || !isDeadValue(current.value, current.stateKey)) continue;
      const stateStart = stateCurrentStart(current, context);
      if (
        storyOrder <= stateStart &&
        (current.validFromSceneId === scene.id || current.sourceSpan?.sceneId === scene.id)
      ) {
        // A character is allowed to appear in the scene in which the death
        // state is established; the state applies to subsequent scenes.
        continue;
      }
      const deathEvidence = sourceEvidence(current);
      context.add({
        code: 'dead-character-appears',
        category: 'continuity',
        severity: 'error',
        message: `${characterName(context, characterId)} appears in “${scene.title}” while their active story state is dead.`,
        evidence: [...(deathEvidence ? [deathEvidence] : []), sceneEvidence(scene)],
        relatedRefs: [
          reference('character', characterId, undefined, characterName(context, characterId)),
          reference('entity-state', current.id, current.key),
          sceneReference(scene)
        ],
        suggestedResolution: 'Remove the appearance, move it before the death, or explicitly establish a permitted return.'
      });
    }
  }
}

function runAppearanceContinuityRules(context: DiagnosticContext): void {
  const attributes = [
    {
      key: 'eye-color',
      noun: 'eyes?',
      values: ['amber', 'black', 'blue', 'brown', 'gold', 'gray', 'green', 'grey', 'hazel', 'silver', 'violet']
    },
    {
      key: 'hair-color',
      noun: 'hair',
      values: ['auburn', 'black', 'blond', 'blonde', 'brown', 'gray', 'green', 'grey', 'red', 'silver', 'white']
    }
  ] as const;
  const units = proseUnits(context);

  for (const character of context.input.characters) {
    const names = uniqueBy([character.name, ...(character.aliases ?? [])].filter(Boolean), (value) => value);
    for (const attribute of attributes) {
      const observations: Array<{ value: string; evidence: StorySourceSpan }> = [];
      for (const unit of units) {
        for (const name of names) {
          const colorAlternation = attribute.values.map(escapeRegex).join('|');
          const direct = new RegExp(
            `\\b${escapeRegex(name)}(?:['’]s)\\s+(${colorAlternation})\\s+${attribute.noun}\\b`,
            'giu'
          );
          const reversed = new RegExp(
            `\\b${escapeRegex(name)}(?:['’]s)\\s+${attribute.noun}\\s+(?:was|were|is|are|looked|seemed)\\s+(${colorAlternation})\\b`,
            'giu'
          );
          for (const pattern of [direct, reversed]) {
            for (const match of unit.text.matchAll(pattern)) {
              const quote = match[0];
              observations.push({
                value: normalizeColor(match[1]),
                evidence: findEvidenceAt(unit, quote, match.index ?? 0)
              });
            }
          }
        }
      }
      const values = uniqueBy(observations.map((observation) => observation.value), (value) => value);
      if (values.length < 2) continue;
      context.add({
        code: `${attribute.key}-drift`,
        category: 'continuity',
        severity: 'warning',
        message: `${character.name} has conflicting ${attribute.key.replace('-', ' ')} descriptions: ${values.join(', ')}.`,
        evidence: observations.map((observation) => observation.evidence),
        relatedRefs: [reference('character', character.id, character.key, character.name)],
        suggestedResolution: `Choose the canonical ${attribute.key.replace('-', ' ')} and revise the conflicting description.`
      });
    }
  }
}

function runObjectTransferContinuityRules(
  context: DiagnosticContext,
  activeStates: EntityState[]
): void {
  const ownershipStates = activeStates.filter((state) =>
    /owner|ownership|holder|possessor|possession/.test(normalizeKey(state.stateKey))
  );
  const byObject = groupBy(
    ownershipStates,
    (state) => `${normalizeKey(state.entityType)}:${state.entityId}:${normalizeKey(state.stateKey)}`
  );
  const transfers = context.scenes.flatMap((scene) =>
    sceneObjectTransfers(scene).map((transfer) => ({ ...transfer, scene, order: sceneRank(context, scene.id) }))
  );

  for (const states of byObject.values()) {
    const sorted = [...states].sort(
      (left, right) =>
        stateCurrentStart(left, context) - stateCurrentStart(right, context) ||
        left.id.localeCompare(right.id)
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const fromOwner = jsonString(previous.value);
      const toOwner = jsonString(current.value);
      if (!fromOwner || !toOwner || fromOwner === toOwner) continue;
      const previousOrder = stateCurrentStart(previous, context);
      const currentOrder = stateCurrentStart(current, context);
      const hasTransfer = transfers.some(
        (transfer) =>
          normalizeKey(transfer.objectId) === normalizeKey(current.entityId) &&
          normalizeKey(transfer.fromOwnerId) === normalizeKey(fromOwner) &&
          normalizeKey(transfer.toOwnerId) === normalizeKey(toOwner) &&
          transfer.order >= previousOrder &&
          transfer.order <= currentOrder
      );
      if (hasTransfer) continue;
      const previousEvidence = sourceEvidence(previous);
      const currentEvidence = sourceEvidence(current);
      context.add({
        code: 'object-owner-changed-without-transfer',
        category: 'continuity',
        severity: 'error',
        message: `${current.entityType} “${current.entityId}” changes holder from ${fromOwner} to ${toOwner} without a recorded transfer.`,
        evidence: [
          ...(previousEvidence ? [previousEvidence] : []),
          ...(currentEvidence ? [currentEvidence] : [])
        ],
        relatedRefs: [
          reference('entity-state', previous.id, previous.key),
          reference('entity-state', current.id, current.key),
          reference(current.entityType, current.entityId)
        ],
        suggestedResolution: 'Record the intervening handoff/loss/theft/destruction or correct the ownership states.'
      });
    }
  }
}

function runChronologyRules(context: DiagnosticContext): void {
  if (!context.input.projectRules?.allowNonlinearChronology) {
    let previous: DiagnosticSceneSnapshot | null = null;
    let previousTimestamp: number | null = null;
    for (const scene of context.scenes) {
      const timestamp = parseSceneTimestamp(scene);
      if (timestamp === null) continue;
      if (
        previous &&
        previousTimestamp !== null &&
        timestamp < previousTimestamp &&
        scene.chronologyMode !== 'flashback' &&
        previous.chronologyMode !== 'flashforward'
      ) {
        context.add({
          code: 'manuscript-time-reversal',
          category: 'chronology',
          severity: 'warning',
          message: `“${scene.title}” is dated before the preceding scene “${previous.title}” without a nonlinear-story marker.`,
          evidence: [sceneEvidence(previous), sceneEvidence(scene)],
          relatedRefs: [sceneReference(previous), sceneReference(scene)],
          suggestedResolution: 'Correct the dates or mark the scene as an intentional flashback/flash-forward.'
        });
      }
      previous = scene;
      previousTimestamp = timestamp;
    }
  }

  const events = context.input.timelineEvents.filter((event) => event.isCurrent && event.invalidatedAt === null);
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const event of events) {
    const eventOrder = event.sortOrder ?? parseChronology(event.chronology);
    for (const dependencyId of event.dependencyIds) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        context.add({
          code: 'missing-timeline-prerequisite',
          category: 'chronology',
          severity: 'error',
          message: `Timeline event “${event.title}” depends on missing event “${dependencyId}”.`,
          evidence: eventEvidence(event),
          relatedRefs: [reference('timeline-event', event.id, event.key, event.title)],
          suggestedResolution: 'Restore the prerequisite event or remove the stale dependency.'
        });
        continue;
      }
      const dependencyOrder = dependency.sortOrder ?? parseChronology(dependency.chronology);
      if (eventOrder === null || dependencyOrder === null || eventOrder > dependencyOrder) continue;
      context.add({
        code: 'timeline-prerequisite-after-event',
        category: 'chronology',
        severity: 'error',
        message: `Timeline prerequisite “${dependency.title}” does not occur before “${event.title}”.`,
        evidence: [...eventEvidence(dependency), ...eventEvidence(event)],
        relatedRefs: [
          reference('timeline-event', dependency.id, dependency.key, dependency.title),
          reference('timeline-event', event.id, event.key, event.title)
        ],
        suggestedResolution: 'Move the prerequisite earlier or repair the dependency direction.'
      });
    }
  }

  runTravelRules(context);
}

function runTravelRules(context: DiagnosticContext): void {
  const travelRules = context.input.projectRules?.travelTimes ?? [];
  if (travelRules.length === 0) return;
  const minimumTravel = buildTravelMap(travelRules);
  const appearances = new Map<
    string,
    Array<{ scene: DiagnosticSceneSnapshot; timestamp: number; locationId: string }>
  >();
  for (const scene of context.scenes) {
    if (!scene.storyTime || !scene.locationId) continue;
    const timestamp = parseSceneTimestamp(scene);
    if (timestamp === null) continue;
    const ids = uniqueBy(
      [...scene.characterPresentIds, ...(scene.povCharacterId ? [scene.povCharacterId] : [])],
      (value) => value
    );
    for (const characterId of ids) {
      appearances.set(characterId, [
        ...(appearances.get(characterId) ?? []),
        { scene, timestamp, locationId: scene.locationId }
      ]);
    }
  }
  for (const [characterId, values] of appearances) {
    const sorted = values.sort(
      (left, right) => left.timestamp - right.timestamp || sceneRank(context, left.scene.id) - sceneRank(context, right.scene.id)
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous.locationId === current.locationId) continue;
      const minimum = minimumTravel.get(`${previous.locationId}->${current.locationId}`);
      if (minimum === undefined) continue;
      const elapsedMinutes = (current.timestamp - previous.timestamp) / 60_000;
      if (elapsedMinutes >= minimum) continue;
      context.add({
        code: 'impossible-travel',
        category: 'chronology',
        severity: 'error',
        message: `${characterName(context, characterId)} has ${formatMinutes(elapsedMinutes)} to travel from ${locationName(
          context,
          previous.locationId
        )} to ${locationName(context, current.locationId)}, but the route requires at least ${formatMinutes(minimum)}.`,
        evidence: [sceneEvidence(previous.scene), sceneEvidence(current.scene)],
        relatedRefs: [
          reference('character', characterId, undefined, characterName(context, characterId)),
          sceneReference(previous.scene),
          sceneReference(current.scene)
        ],
        suggestedResolution: 'Increase the elapsed story time, change a location, or establish faster transportation in canon.'
      });
    }
  }
}

function runLocationRules(context: DiagnosticContext): void {
  const simultaneous = new Map<string, DiagnosticSceneSnapshot[]>();
  for (const scene of context.scenes) {
    if (!scene.locationId || !scene.storyTime) continue;
    const timestamp = parseSceneTimestamp(scene);
    if (timestamp === null) continue;
    const characterIds = uniqueBy(
      [...scene.characterPresentIds, ...(scene.povCharacterId ? [scene.povCharacterId] : [])],
      (value) => value
    );
    for (const characterId of characterIds) {
      const key = `${characterId}:${timestamp}`;
      simultaneous.set(key, [...(simultaneous.get(key) ?? []), scene]);
    }
  }
  for (const [key, scenes] of simultaneous) {
    const locations = uniqueBy(
      scenes.flatMap((scene) => (scene.locationId ? [scene.locationId] : [])),
      (value) => value
    );
    if (locations.length < 2) continue;
    const characterId = key.slice(0, key.lastIndexOf(':'));
    context.add({
      code: 'simultaneous-incompatible-locations',
      category: 'location',
      severity: 'error',
      message: `${characterName(context, characterId)} appears in ${locations.length} different locations at the same story time.`,
      evidence: scenes.map((scene) => sceneEvidence(scene)),
      relatedRefs: [
        reference('character', characterId, undefined, characterName(context, characterId)),
        ...scenes.map(sceneReference)
      ],
      suggestedResolution: 'Correct the time/location metadata or separate the appearances chronologically.'
    });
  }

  const locationStates = context.input.entityStates.filter(
    (state) =>
      state.isCurrent &&
      state.status === 'active' &&
      state.invalidatedAt === null &&
      /character|person/.test(normalizeKey(state.entityType)) &&
      /location|place|whereabouts/.test(normalizeKey(state.stateKey))
  );
  for (const scene of context.scenes) {
    if (!scene.locationId) continue;
    const order = sceneRank(context, scene.id);
    const characters = uniqueBy(
      [...scene.characterPresentIds, ...(scene.povCharacterId ? [scene.povCharacterId] : [])],
      (value) => value
    );
    for (const characterId of characters) {
      const current = currentStateAt(
        locationStates.filter((state) => state.entityId === characterId),
        order,
        context
      );
      const recordedLocation = current ? jsonString(current.value) : null;
      if (!current || !recordedLocation || recordedLocation === scene.locationId) continue;
      const stateEvidence = sourceEvidence(current);
      context.add({
        code: 'scene-location-state-mismatch',
        category: 'location',
        severity: 'error',
        message: `${characterName(context, characterId)} is recorded at ${locationName(
          context,
          recordedLocation
        )} but appears in scene “${scene.title}” at ${locationName(context, scene.locationId)}.`,
        evidence: [...(stateEvidence ? [stateEvidence] : []), sceneEvidence(scene)],
        relatedRefs: [
          reference('entity-state', current.id, current.key),
          reference('character', characterId, undefined, characterName(context, characterId)),
          sceneReference(scene)
        ],
        suggestedResolution: 'Record the intervening movement or correct the scene/state location.'
      });
    }
  }

  for (const scene of context.scenes) {
    if (!scene.locationId || context.locationById.has(scene.locationId)) continue;
    context.add({
      code: 'unknown-scene-location',
      category: 'location',
      severity: 'error',
      message: `Scene “${scene.title}” references unknown location “${scene.locationId}”.`,
      evidence: [sceneEvidence(scene)],
      relatedRefs: [sceneReference(scene), reference('location', scene.locationId)],
      suggestedResolution: 'Create the location or choose an existing location from the Story Bible.'
    });
  }
}

function runKnowledgeRules(context: DiagnosticContext): void {
  const baseline = characterBibleKnowledge(context);
  const canonical = canonicalKnowledge(context);
  const events = new Map<string, Array<{ order: number; operation: 'gain' | 'lose' }>>();
  const claims: Array<{ scene: DiagnosticSceneSnapshot; claim: DiagnosticKnowledgeClaim }> = [];

  for (const scene of context.scenes) {
    const order = sceneRank(context, scene.id);
    for (const delta of sceneKnowledgeDeltas(scene)) {
      const key = knowledgeSlot(delta.characterId, delta.knowledgeKey);
      events.set(key, [...(events.get(key) ?? []), { order, operation: delta.operation }]);
    }
    for (const claim of sceneKnowledgeClaims(scene)) claims.push({ scene, claim });
  }

  for (const { scene, claim } of claims) {
    const slot = knowledgeSlot(claim.characterId, claim.knowledgeKey);
    const order = sceneRank(context, scene.id);
    const inBible = baseline.has(slot);
    const inCanon = (canonical.get(slot) ?? []).some(
      (interval) => order >= interval.start && order <= interval.end
    );
    const priorEvents = (events.get(slot) ?? [])
      .filter((event) => event.order <= order)
      .sort((left, right) => left.order - right.order);
    const learnedByDelta = priorEvents.at(-1)?.operation === 'gain';
    if (inBible || inCanon || learnedByDelta) continue;

    const futureOrder = Math.min(
      ...(canonical.get(slot) ?? []).map((interval) => interval.start).filter((value) => value > order),
      ...(events.get(slot) ?? []).map((event) => event.order).filter((value) => value > order),
      Number.POSITIVE_INFINITY
    );
    if (
      !Number.isFinite(futureOrder) &&
      context.input.projectRules?.requireKnowledgeProvenance === false
    ) {
      continue;
    }
    const quote = claim.quote || claim.knowledgeKey;
    const evidence = sceneEvidence(scene, {
      quote,
      start: claim.start,
      end: claim.end
    });
    const futureScene = Number.isFinite(futureOrder) ? context.scenes[futureOrder] : undefined;
    context.add({
      code: Number.isFinite(futureOrder) ? 'knowledge-used-too-early' : 'knowledge-without-provenance',
      category: 'knowledge',
      severity: Number.isFinite(futureOrder) ? 'error' : 'warning',
      message: Number.isFinite(futureOrder)
        ? `${characterName(context, claim.characterId)} uses “${claim.knowledgeKey}” before learning it.`
        : `${characterName(context, claim.characterId)} uses “${claim.knowledgeKey}” with no recorded source of knowledge.`,
      evidence: [evidence, ...(futureScene ? [sceneEvidence(futureScene)] : [])],
      relatedRefs: [
        reference('character', claim.characterId, undefined, characterName(context, claim.characterId)),
        sceneReference(scene),
        ...(futureScene ? [sceneReference(futureScene)] : [])
      ],
      suggestedResolution: Number.isFinite(futureOrder)
        ? 'Move the disclosure earlier, move this use later, or establish another credible source.'
        : 'Record where the character learned this fact or revise the scene.'
    });
  }
}

function runWorldRuleRules(context: DiagnosticContext): void {
  const worldArtifacts = context.activeArtifacts.filter(
    (artifact) => artifact.type === 'world-bible' && isJsonObject(artifact.content)
  );
  const rules = new Map<string, Array<{ statement: string; artifact: StoryArtifact }>>();
  for (const artifact of worldArtifacts) {
    const entries = Array.isArray((artifact.content as JsonObject).rules)
      ? ((artifact.content as JsonObject).rules as JsonValue[])
      : [];
    for (const entry of entries) {
      if (!isJsonObject(entry)) continue;
      const key = jsonString(entry.key);
      const statement = jsonString(entry.statement);
      if (!key || !statement) continue;
      rules.set(normalizeKey(key), [...(rules.get(normalizeKey(key)) ?? []), { statement, artifact }]);
    }
  }

  for (const [key, definitions] of rules) {
    const statements = uniqueBy(definitions.map((value) => normalizeText(value.statement)), (value) => value);
    if (statements.length < 2) continue;
    context.add({
      code: 'world-rule-definition-conflict',
      category: 'world-rule',
      severity: 'error',
      message: `World rule “${key}” has incompatible active definitions.`,
      evidence: definitions.map((definition) => artifactEvidence(definition.artifact.id)),
      relatedRefs: definitions.map((definition) =>
        reference('artifact', definition.artifact.id, definition.artifact.key, definition.artifact.title)
      ),
      suggestedResolution: 'Keep one canonical definition or version the rule with explicit validity.'
    });
  }

  for (const scene of context.scenes) {
    for (const ruleKey of worldRuleReferences(scene.worldRuleRefs)) {
      if (rules.has(normalizeKey(ruleKey))) continue;
      context.add({
        code: 'unknown-world-rule-reference',
        category: 'world-rule',
        severity: 'error',
        message: `Scene “${scene.title}” invokes unknown world rule “${ruleKey}”.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene), reference('world-rule', ruleKey, ruleKey)],
        suggestedResolution: 'Define the rule in the active World Bible or correct the reference.'
      });
    }
    for (const violation of scene.worldRuleViolations ?? []) {
      const quote = violation.quote || violation.explanation;
      context.add({
        code: 'world-rule-violation',
        category: 'world-rule',
        severity: 'error',
        message: `Scene “${scene.title}” violates world rule “${violation.ruleKey}”: ${violation.explanation}`,
        evidence: [
          sceneEvidence(scene, {
            quote,
            start: violation.start,
            end: violation.end
          }),
          ...(rules.get(normalizeKey(violation.ruleKey)) ?? []).map((definition) =>
            artifactEvidence(definition.artifact.id)
          )
        ],
        relatedRefs: [sceneReference(scene), reference('world-rule', violation.ruleKey, violation.ruleKey)],
        suggestedResolution: 'Revise the event or intentionally amend the canonical world rule.'
      });
    }
  }
}

function runCharacterRules(context: DiagnosticContext): void {
  for (const scene of context.scenes) {
    const characterIds = uniqueBy(
      [
        ...scene.characterPresentIds,
        ...scene.characterReferencedIds,
        ...(scene.povCharacterId ? [scene.povCharacterId] : []),
        ...(scene.knowledgeClaims ?? []).map((claim) => claim.characterId),
        ...(scene.normalizedKnowledgeDeltas ?? []).map((delta) => delta.characterId),
        ...(scene.characterSignals ?? []).map((signal) => signal.characterId),
        ...(scene.dialogueTurns ?? []).flatMap((turn) => (turn.speakerId ? [turn.speakerId] : []))
      ],
      (value) => value
    );
    for (const characterId of characterIds) {
      if (context.characterById.has(characterId)) continue;
      context.add({
        code: 'unknown-character-reference',
        category: 'character',
        severity: 'error',
        message: `Scene “${scene.title}” references unknown character “${characterId}”.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene), reference('character', characterId)],
        suggestedResolution: 'Create the character in the Story Bible or correct the reference.'
      });
    }
    for (const signal of scene.characterSignals ?? []) {
      if (signal.contradicts.length === 0) continue;
      context.add({
        code: `character-${signal.kind}-discontinuity`,
        category: 'character',
        severity: 'warning',
        message: `${characterName(context, signal.characterId)} has a ${signal.kind} discontinuity in “${scene.title}”: ${signal.value}`,
        evidence: [
          sceneEvidence(scene, {
            quote: signal.quote || signal.value,
            start: signal.start,
            end: signal.end
          })
        ],
        relatedRefs: [
          reference('character', signal.characterId, undefined, characterName(context, signal.characterId)),
          sceneReference(scene)
        ],
        suggestedResolution: `Reconcile the scene with the character’s ${signal.contradicts.join(', ')} or establish the change on-page.`
      });
    }
  }

  const bibleArtifacts = context.activeArtifacts.filter(
    (artifact) => artifact.type === 'character-bible' && isJsonObject(artifact.content)
  );
  const byKey = groupBy(
    bibleArtifacts,
    (artifact) => normalizeKey(jsonString((artifact.content as JsonObject).characterKey) ?? artifact.key)
  );
  for (const artifacts of byKey.values()) {
    if (artifacts.length < 2) continue;
    context.add({
      code: 'duplicate-character-bible',
      category: 'character',
      severity: 'error',
      message: `${artifacts.length} active Character Bibles describe “${artifacts[0].key}”.`,
      evidence: artifacts.map((artifact) => artifactEvidence(artifact.id)),
      relatedRefs: artifacts.map((artifact) =>
        reference('artifact', artifact.id, artifact.key, artifact.title)
      ),
      suggestedResolution: 'Merge the character records and supersede the obsolete artifacts.'
    });
  }
}

function runPovRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.pov ?? narrativeContractPovRules(context);
  const allowed = new Set(rules.allowedCharacterIds ?? []);
  for (const scene of context.scenes) {
    if (rules.requiredCharacterId && scene.povCharacterId !== rules.requiredCharacterId) {
      context.add({
        code: 'forbidden-pov-character',
        category: 'pov',
        severity: 'error',
        message: `Scene “${scene.title}” uses ${characterName(
          context,
          scene.povCharacterId
        )} as POV, but the narrative contract requires ${characterName(context, rules.requiredCharacterId)}.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene)],
        suggestedResolution: 'Change the scene POV or explicitly revise the narrative contract.'
      });
    } else if (allowed.size > 0 && scene.povCharacterId && !allowed.has(scene.povCharacterId)) {
      context.add({
        code: 'forbidden-pov-character',
        category: 'pov',
        severity: 'error',
        message: `${characterName(context, scene.povCharacterId)} is not an allowed POV character for “${scene.title}”.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene), reference('character', scene.povCharacterId)],
        suggestedResolution: 'Use an allowed POV or update the project’s narrative contract.'
      });
    }

    const interiority = uniqueBy(scene.interiorityCharacterIds ?? [], (value) => value);
    if (
      rules.mode !== 'omniscient' &&
      /close/i.test(rules.narrativeDistance ?? '') &&
      interiority.some((characterId) => characterId !== scene.povCharacterId)
    ) {
      context.add({
        code: 'head-hopping',
        category: 'pov',
        severity: 'warning',
        message: `Scene “${scene.title}” enters the interiority of ${interiority
          .filter((id) => id !== scene.povCharacterId)
          .map((id) => characterName(context, id))
          .join(', ')} outside its close POV.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene), ...interiority.map((id) => reference('character', id))],
        suggestedResolution: 'Keep interior access with the POV character or mark a deliberate POV break.'
      });
    }
  }

  if (rules.singlePovPerChapter) {
    for (const chapter of context.chapters) {
      const povIds = uniqueBy(
        chapter.scenes.flatMap((scene) => (scene.povCharacterId ? [scene.povCharacterId] : [])),
        (value) => value
      );
      if (povIds.length < 2) continue;
      context.add({
        code: 'chapter-pov-switch',
        category: 'pov',
        severity: 'warning',
        message: `Chapter ${chapter.number}, “${chapter.title},” uses ${povIds.length} POV characters despite the one-POV-per-chapter rule.`,
        evidence: chapter.scenes.filter((scene) => scene.povCharacterId).map((scene) => sceneEvidence(scene)),
        relatedRefs: [chapterReference(chapter), ...povIds.map((id) => reference('character', id))],
        suggestedResolution: 'Split the chapter at the POV change or keep one viewpoint.'
      });
    }
  }
}

function runSetupPayoffRules(context: DiagnosticContext): void {
  const setups = context.input.setupPayoffs.filter(
    (setup) => setup.isCurrent && setup.invalidatedAt === null && setup.status !== 'invalidated' && setup.status !== 'abandoned'
  );
  for (const setup of setups) {
    const setupEvidence = linkedEvidence(setup.setupSceneId, setup.setupArtifactId, context);
    const payoffEvidence = linkedEvidence(setup.payoffSceneId, setup.payoffArtifactId, context);
    const reinforcementEvidence = setup.reinforcementSceneIds.flatMap((sceneId) =>
      context.sceneById.has(sceneId) ? [sceneEvidence(context.sceneById.get(sceneId)!)] : []
    );
    if (setup.status === 'paid-off' && setupEvidence.length === 0) {
      context.add({
        code: 'payoff-without-setup',
        category: 'setup-payoff',
        severity: 'error',
        message: `Payoff “${setup.title}” has no linked setup evidence.`,
        evidence: payoffEvidence,
        relatedRefs: [reference('setup-payoff', setup.id, setup.key, setup.title)],
        suggestedResolution: 'Link an earlier setup scene/artifact or revise the payoff status.'
      });
    }
    if (['setup', 'reinforced'].includes(setup.status) && payoffEvidence.length === 0) {
      context.add({
        code: 'unpaid-setup',
        category: 'setup-payoff',
        severity: isManuscriptComplete(context.input) ? 'error' : 'warning',
        message: `Setup “${setup.title}” has no planned payoff.`,
        evidence: [...setupEvidence, ...reinforcementEvidence],
        relatedRefs: [reference('setup-payoff', setup.id, setup.key, setup.title)],
        suggestedResolution: 'Plan and link a payoff, or intentionally abandon the setup.'
      });
    }
    const setupOrder = linkedOrder(setup.setupSceneId, context);
    const payoffOrder = linkedOrder(setup.payoffSceneId, context);
    if (setupOrder !== null && payoffOrder !== null && payoffOrder <= setupOrder) {
      context.add({
        code: 'payoff-before-setup',
        category: 'setup-payoff',
        severity: 'error',
        message: `Payoff “${setup.title}” occurs before or in the same scene as its setup.`,
        evidence: [...setupEvidence, ...payoffEvidence],
        relatedRefs: [reference('setup-payoff', setup.id, setup.key, setup.title)],
        suggestedResolution: 'Move the setup earlier, move the payoff later, or correct the links.'
      });
    }
    for (const sceneId of setup.reinforcementSceneIds) {
      const order = linkedOrder(sceneId, context);
      if (
        order === null ||
        (setupOrder !== null && order <= setupOrder) ||
        (payoffOrder !== null && order >= payoffOrder)
      ) {
        const scene = context.sceneById.get(sceneId);
        context.add({
          code: 'reinforcement-outside-setup-payoff-window',
          category: 'setup-payoff',
          severity: 'warning',
          message: `A reinforcement for “${setup.title}” is not positioned between setup and payoff.`,
          evidence: [
            ...setupEvidence,
            ...(scene ? [sceneEvidence(scene)] : []),
            ...payoffEvidence
          ],
          relatedRefs: [reference('setup-payoff', setup.id, setup.key, setup.title)],
          suggestedResolution: 'Relink or reorder the reinforcement so it strengthens the established promise.'
        });
      }
    }
  }

  for (const loop of context.input.openLoops.filter(
    (value) => value.isCurrent && value.invalidatedAt === null && value.status !== 'invalidated' && value.status !== 'abandoned'
  )) {
    const introducedEvidence = linkedEvidence(
      loop.introducedSceneId,
      loop.introducedArtifactId,
      context
    );
    const resolvedEvidence = linkedEvidence(loop.resolvedSceneId, loop.resolvedArtifactId, context);
    if (loop.status === 'resolved' && resolvedEvidence.length === 0) {
      context.add({
        code: 'resolution-without-evidence',
        category: 'setup-payoff',
        severity: 'error',
        message: `Resolved ${loop.kind} “${loop.title}” has no linked resolution evidence.`,
        evidence: introducedEvidence,
        relatedRefs: [reference('open-loop', loop.id, loop.key, loop.title)],
        suggestedResolution: 'Link the resolving scene/artifact or return the loop to an open status.'
      });
    } else if (isManuscriptComplete(context.input) && ['open', 'reinforced'].includes(loop.status)) {
      context.add({
        code: 'unresolved-open-loop',
        category: 'setup-payoff',
        severity: loop.kind === 'mystery' || loop.kind === 'promise' ? 'error' : 'warning',
        message: `${loop.kind} “${loop.title}” remains unresolved in the completed manuscript.`,
        evidence: introducedEvidence,
        relatedRefs: [reference('open-loop', loop.id, loop.key, loop.title)],
        suggestedResolution: 'Resolve the loop on-page or mark it intentionally abandoned.'
      });
    }
  }
}

function runPlotRules(context: DiagnosticContext): void {
  const plannedDependencies = sceneDependencies(context);
  for (const item of plannedDependencies) {
    for (const dependencyId of item.dependencyIds) {
      const dependency = plannedDependencies.find(
        (candidate) => candidate.id === dependencyId || candidate.key === dependencyId
      );
      if (!dependency) {
        context.add({
          code: 'missing-causal-predecessor',
          category: 'plot',
          severity: 'error',
          message: `Scene “${item.title}” depends on missing causal predecessor “${dependencyId}”.`,
          evidence: item.evidence,
          relatedRefs: item.refs,
          suggestedResolution: 'Restore the predecessor, relink the dependency, or revise the causal chain.'
        });
      } else if (dependency.order >= item.order) {
        context.add({
          code: 'causal-predecessor-after-scene',
          category: 'plot',
          severity: 'error',
          message: `Scene “${item.title}” occurs before its causal predecessor “${dependency.title}”.`,
          evidence: [...dependency.evidence, ...item.evidence],
          relatedRefs: [...dependency.refs, ...item.refs],
          suggestedResolution: 'Reorder the scenes or correct the dependency direction.'
        });
      }
    }
  }
  const cycle = hasCycle(
    plannedDependencies.map((item) => ({
      id: item.id,
      dependencyIds: item.dependencyIds
        .map((dependency) =>
          plannedDependencies.find((candidate) => candidate.id === dependency || candidate.key === dependency)?.id
        )
        .filter((value): value is string => Boolean(value))
    }))
  );
  if (cycle) {
    const involved = cycle.flatMap((id) => {
      const item = plannedDependencies.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    });
    context.add({
      code: 'scene-causality-cycle',
      category: 'plot',
      severity: 'error',
      message: `The scene causality graph contains a cycle: ${involved.map((item) => item.title).join(' → ')}.`,
      evidence: involved.flatMap((item) => item.evidence),
      relatedRefs: involved.flatMap((item) => item.refs),
      suggestedResolution: 'Break the circular dependency so every scene has an executable causal order.'
    });
  }

  const requireDependencies =
    context.input.projectRules?.plot?.requireSceneDependencies &&
    context.input.metadata?.planningMode !== 'pantser';
  if (requireDependencies) {
    for (const item of plannedDependencies.slice(1)) {
      if (item.dependencyIds.length > 0) continue;
      context.add({
        code: 'scene-without-causal-bridge',
        category: 'plot',
        severity: 'warning',
        message: `Scene “${item.title}” has no declared causal predecessor.`,
        evidence: item.evidence,
        relatedRefs: item.refs,
        suggestedResolution: 'Link the event that causes or enables this scene, or mark it as a deliberate new sequence opening.'
      });
    }
  }

  const beats = context.activeArtifacts.filter(
    (artifact) => artifact.type === 'beat' && isJsonObject(artifact.content)
  );
  const beatSignatures = groupBy(beats, (artifact) => {
    const content = artifact.content as JsonObject;
    return stableStringify({
      function: normalizeText(jsonString(content.function) ?? ''),
      causes: stringArray(content.causeKeys).sort(),
      consequences: stringArray(content.consequenceKeys).sort()
    });
  });
  for (const duplicates of beatSignatures.values()) {
    if (duplicates.length < 2 || normalizeText(jsonString((duplicates[0].content as JsonObject).function) ?? '').length < 5) {
      continue;
    }
    context.add({
      code: 'duplicated-beat',
      category: 'plot',
      severity: 'warning',
      message: `${duplicates.length} active beats have the same function and causal links.`,
      evidence: duplicates.map((artifact) => artifactEvidence(artifact.id)),
      relatedRefs: duplicates.map((artifact) =>
        reference('artifact', artifact.id, artifact.key, artifact.title)
      ),
      suggestedResolution: 'Differentiate the beats or merge the duplicate structural work.'
    });
  }

  if (!isManuscriptComplete(context.input)) return;
  const dormantThreshold = context.input.projectRules?.plot?.dormantThreadSceneCount ?? 8;
  for (const thread of context.input.plotThreads.filter(
    (value) => value.isCurrent && value.invalidatedAt === null && value.status !== 'invalidated' && value.status !== 'abandoned'
  )) {
    const orders = thread.sceneIds
      .map((sceneId) => context.sceneOrder.get(sceneId))
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    if (
      thread.status === 'active' &&
      orders.length > 0 &&
      context.scenes.length - 1 - orders.at(-1)! >= dormantThreshold
    ) {
      context.add({
        code: 'dormant-plot-thread',
        category: 'plot',
        severity: thread.kind === 'main' ? 'error' : 'warning',
        message: `${thread.kind} thread “${thread.title}” disappears for the final ${
          context.scenes.length - 1 - orders.at(-1)!
        } scenes.`,
        evidence: orders.flatMap((order) =>
          context.scenes[order] ? [sceneEvidence(context.scenes[order])] : []
        ),
        relatedRefs: [reference('plot-thread', thread.id, thread.key, thread.title)],
        suggestedResolution: 'Resume and resolve the thread, or mark it intentionally abandoned.'
      });
    }
    if (thread.kind === 'main' && thread.status !== 'resolved') {
      context.add({
        code: 'unresolved-main-plot',
        category: 'plot',
        severity: 'error',
        message: `Main plot thread “${thread.title}” is not resolved in the completed manuscript.`,
        evidence: orders.flatMap((order) =>
          context.scenes[order] ? [sceneEvidence(context.scenes[order])] : []
        ),
        relatedRefs: [reference('plot-thread', thread.id, thread.key, thread.title)],
        suggestedResolution: 'Resolve the main dramatic question or revise the thread status with evidence.'
      });
    }
  }
}

function runPacingRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.pacing ?? {};
  const chapterCounts = context.chapters.map((chapter) => ({
    chapter,
    count: wordCount(chapter.content) || chapter.scenes.reduce((sum, scene) => sum + wordCount(scene.content), 0)
  }));
  const usable = chapterCounts.filter((item) => item.count > 0);
  const minimumChapters = rules.minimumChaptersForSizeComparison ?? 4;
  if (usable.length >= minimumChapters) {
    const manuscriptMedian = median(usable.map((item) => item.count));
    const lowRatio = rules.chapterWordCountLowRatio ?? 0.4;
    const highRatio = rules.chapterWordCountHighRatio ?? 2.5;
    if (manuscriptMedian && manuscriptMedian > 0) {
      for (const item of usable) {
        const ratio = item.count / manuscriptMedian;
        if (ratio >= lowRatio && ratio <= highRatio) continue;
        context.add({
          code: ratio < lowRatio ? 'abruptly-short-chapter' : 'abruptly-long-chapter',
          category: 'pacing',
          severity: 'info',
          message: `Chapter ${item.chapter.number}, “${item.chapter.title},” is ${item.count} words versus a ${Math.round(
            manuscriptMedian
          )}-word manuscript median.`,
          evidence: [chapterEvidence(item.chapter)],
          relatedRefs: [chapterReference(item.chapter)],
          suggestedResolution: 'Confirm the size change is intentional or rebalance the chapter boundary.'
        });
      }
    }
  }

  const tolerance = rules.sceneTargetToleranceRatio ?? 0.6;
  for (const scene of context.scenes) {
    if (!scene.estimatedWordCount || scene.actualWordCount <= 0) continue;
    const ratio = scene.actualWordCount / scene.estimatedWordCount;
    if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) continue;
    context.add({
      code: 'scene-word-target-outlier',
      category: 'pacing',
      severity: 'info',
      message: `Scene “${scene.title}” is ${scene.actualWordCount} words against a ${scene.estimatedWordCount}-word plan.`,
      evidence: [sceneEvidence(scene)],
      relatedRefs: [sceneReference(scene)],
      suggestedResolution: 'Confirm the scene earns its current length or revise the plan/boundary.'
    });
  }

  if (context.input.metadata?.planningMode === 'pantser') return;
  const lowConflictRunLength = Math.max(2, rules.lowConflictRunLength ?? 4);
  const lowConflict: DiagnosticSceneSnapshot[] = [];
  const flushLowConflict = () => {
    if (lowConflict.length < lowConflictRunLength) {
      lowConflict.splice(0);
      return;
    }
    context.add({
      code: 'long-low-conflict-run',
      category: 'pacing',
      severity: 'warning',
      message: `${lowConflict.length} consecutive planned scenes have goals/functions but no obstacle, conflict, or stakes.`,
      evidence: lowConflict.map((scene) => sceneEvidence(scene)),
      relatedRefs: lowConflict.map(sceneReference),
      suggestedResolution: 'Add meaningful pressure, compress the run, or confirm it is a deliberate recovery sequence.'
    });
    lowConflict.splice(0);
  };
  for (const scene of context.scenes) {
    const hasPlanning = Boolean(scene.sceneFunction.trim() || scene.goal.trim() || scene.outcome.trim());
    const hasPressure = Boolean(scene.obstacle.trim() || scene.conflict.trim() || scene.stakes.trim());
    if (hasPlanning && !hasPressure) lowConflict.push(scene);
    else flushLowConflict();
  }
  flushLowConflict();

  const revelationThreshold = Math.max(2, rules.revelationClusterLength ?? 3);
  const revelations: DiagnosticSceneSnapshot[] = [];
  const flushRevelations = () => {
    if (revelations.length >= revelationThreshold) {
      context.add({
        code: 'clustered-revelations',
        category: 'pacing',
        severity: 'info',
        message: `${revelations.length} consecutive scenes each deliver a revelation.`,
        evidence: revelations.map((scene) => sceneEvidence(scene, { quote: scene.revelation })),
        relatedRefs: revelations.map(sceneReference),
        suggestedResolution: 'Check whether readers have enough consequence and processing time between revelations.'
      });
    }
    revelations.splice(0);
  };
  for (const scene of context.scenes) {
    if (scene.revelation.trim()) revelations.push(scene);
    else flushRevelations();
  }
  flushRevelations();
}

function runMetadataRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.metadata ?? {};
  const enforceCompleteness = isMetadataEnforced(context.input);
  for (const scene of context.scenes) {
    if (enforceCompleteness) {
      const missing = [
        rules.requirePov && !scene.povCharacterId ? 'POV' : null,
        rules.requireLocation && !scene.locationId ? 'location' : null,
        rules.requireStoryDate && !scene.storyDate ? 'story date' : null,
        rules.requireStoryTime && !scene.storyTime ? 'story time' : null,
        rules.requireSceneFunction && !scene.sceneFunction.trim() ? 'scene function' : null,
        rules.requireGoal && !scene.goal.trim() ? 'goal' : null,
        rules.requireConflict && !scene.conflict.trim() ? 'conflict' : null,
        rules.requireOutcome && !scene.outcome.trim() ? 'outcome' : null,
        rules.requireEmotionalValueShift && !scene.emotionalValueShift.trim()
          ? 'emotional value shift'
          : null
      ].filter((value): value is string => Boolean(value));
      if (missing.length > 0) {
        context.add({
          code: 'required-scene-metadata-missing',
          category: 'metadata',
          severity: 'warning',
          message: `Scene “${scene.title}” is missing required metadata: ${missing.join(', ')}.`,
          evidence: [sceneEvidence(scene)],
          relatedRefs: [sceneReference(scene)],
          suggestedResolution: 'Fill the required fields or relax the project’s metadata policy.'
        });
      }
    }

    if (scene.storyDate && !/^\d{4}-\d{2}-\d{2}$/.test(scene.storyDate)) {
      context.add({
        code: 'invalid-story-date',
        category: 'metadata',
        severity: 'error',
        message: `Scene “${scene.title}” has invalid story date “${scene.storyDate}”; expected YYYY-MM-DD.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene)],
        suggestedResolution: 'Store the story date in ISO YYYY-MM-DD form.'
      });
    }
    if (scene.storyTime && !/^\d{2}:\d{2}(?::\d{2})?$/.test(scene.storyTime)) {
      context.add({
        code: 'invalid-story-time',
        category: 'metadata',
        severity: 'error',
        message: `Scene “${scene.title}” has invalid story time “${scene.storyTime}”; expected HH:MM or HH:MM:SS.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene)],
        suggestedResolution: 'Store the story time in 24-hour ISO time form.'
      });
    }
    const computedWords = wordCount(scene.content);
    if (scene.content.trim() && Math.abs(scene.actualWordCount - computedWords) > 1) {
      context.add({
        code: 'scene-word-count-stale',
        category: 'metadata',
        severity: 'info',
        message: `Scene “${scene.title}” stores ${scene.actualWordCount} words but its prose contains ${computedWords}.`,
        evidence: [sceneEvidence(scene)],
        relatedRefs: [sceneReference(scene)],
        suggestedResolution: 'Recompute and persist the scene word count from the current prose branch.'
      });
    }
  }
}

function runPublishingRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.publishing ?? {};
  const enabled =
    rules.enabled ||
    context.input.metadata?.phase === 'publishing' ||
    context.input.metadata?.phase === 'finalizing';
  if (!enabled) return;

  const numbers = groupBy(context.chapters, (chapter) => String(chapter.number));
  for (const chapters of numbers.values()) {
    if (chapters.length < 2) continue;
    context.add({
      code: 'duplicate-chapter-number',
      category: 'publishing',
      severity: 'error',
      message: `${chapters.length} chapters use number ${chapters[0].number}.`,
      evidence: chapters.map((chapter) => chapterEvidence(chapter)),
      relatedRefs: chapters.map(chapterReference),
      suggestedResolution: 'Assign each manuscript chapter a unique publication number.'
    });
  }

  if (rules.requireSequentialChapterNumbers !== false && context.chapters.length > 0) {
    const sorted = uniqueBy(
      context.chapters.map((chapter) => chapter.number).sort((left, right) => left - right),
      String
    );
    const missing: number[] = [];
    for (let number = sorted[0]; number <= sorted.at(-1)!; number += 1) {
      if (!sorted.includes(number)) missing.push(number);
    }
    if (missing.length > 0) {
      context.add({
        code: 'chapter-number-gap',
        category: 'publishing',
        severity: 'error',
        message: `Publication chapter numbering skips ${missing.join(', ')}.`,
        evidence: context.chapters.map((chapter) => chapterEvidence(chapter)),
        relatedRefs: context.chapters.map(chapterReference),
        suggestedResolution: 'Renumber chapters sequentially or explicitly configure nonstandard numbering.'
      });
    }
  }

  if (rules.requireUniqueChapterTitles) {
    const titles = groupBy(context.chapters, (chapter) => normalizeText(chapter.title));
    for (const chapters of titles.values()) {
      if (chapters.length < 2) continue;
      context.add({
        code: 'duplicate-chapter-title',
        category: 'publishing',
        severity: 'warning',
        message: `${chapters.length} chapters share the title “${chapters[0].title}”.`,
        evidence: chapters.map((chapter) => chapterEvidence(chapter)),
        relatedRefs: chapters.map(chapterReference),
        suggestedResolution: 'Give the chapters distinct titles or disable the uniqueness requirement.'
      });
    }
  }

  for (const chapter of context.chapters) {
    const count = wordCount(chapter.content) || chapter.scenes.reduce((sum, scene) => sum + wordCount(scene.content), 0);
    if (count === 0) {
      context.add({
        code: 'empty-publication-chapter',
        category: 'publishing',
        severity: 'error',
        message: `Chapter ${chapter.number}, “${chapter.title},” has no manuscript prose.`,
        evidence: [chapterEvidence(chapter)],
        relatedRefs: [chapterReference(chapter)],
        suggestedResolution: 'Add prose or exclude the chapter from the publication build.'
      });
    }
    if (rules.requireFinalChapterStatus && chapter.status !== 'final') {
      context.add({
        code: 'chapter-not-final',
        category: 'publishing',
        severity: 'warning',
        message: `Chapter ${chapter.number}, “${chapter.title},” is ${chapter.status}, not final.`,
        evidence: [chapterEvidence(chapter)],
        relatedRefs: [chapterReference(chapter)],
        suggestedResolution: 'Complete the revision/proof pass and mark the chapter final before export.'
      });
    }
  }

  const totalWords = context.chapters.reduce(
    (sum, chapter) =>
      sum +
      (wordCount(chapter.content) || chapter.scenes.reduce((sceneSum, scene) => sceneSum + wordCount(scene.content), 0)),
    0
  );
  if (rules.targetWordCountMin !== undefined && totalWords < rules.targetWordCountMin) {
    context.add({
      code: 'manuscript-below-target-length',
      category: 'publishing',
      severity: 'warning',
      message: `The publication manuscript has ${totalWords} words, below the ${rules.targetWordCountMin}-word minimum.`,
      evidence: context.chapters.map((chapter) => chapterEvidence(chapter)),
      relatedRefs: context.chapters.map(chapterReference),
      suggestedResolution: 'Confirm the intended length or complete the missing manuscript work.'
    });
  }
  if (rules.targetWordCountMax !== undefined && totalWords > rules.targetWordCountMax) {
    context.add({
      code: 'manuscript-above-target-length',
      category: 'publishing',
      severity: 'warning',
      message: `The publication manuscript has ${totalWords} words, above the ${rules.targetWordCountMax}-word maximum.`,
      evidence: context.chapters.map((chapter) => chapterEvidence(chapter)),
      relatedRefs: context.chapters.map(chapterReference),
      suggestedResolution: 'Confirm the intended length or target structural cuts before export.'
    });
  }

  const activeTypes = new Set(context.activeArtifacts.map((artifact) => artifact.type));
  for (const requiredType of rules.requiredArtifactTypes ?? []) {
    if (activeTypes.has(requiredType)) continue;
    context.add({
      code: 'missing-publication-artifact',
      category: 'publishing',
      severity: 'error',
      message: `The publication build requires an active ${requiredType} artifact.`,
      evidence: context.chapters.slice(0, 1).map((chapter) => chapterEvidence(chapter)),
      relatedRefs: [],
      suggestedResolution: `Create and validate the required ${requiredType} artifact before export.`
    });
  }
}

interface NumericInterval {
  start: number;
  end: number;
}

function factInterval(fact: CanonFact, context: DiagnosticContext): NumericInterval {
  return {
    start:
      fact.validFromOrder ??
      (fact.validFromSceneId ? sceneRank(context, fact.validFromSceneId) : Number.NEGATIVE_INFINITY),
    end:
      fact.validToOrder ??
      (fact.validToSceneId ? sceneRank(context, fact.validToSceneId) : Number.POSITIVE_INFINITY)
  };
}

function stateInterval(state: EntityState, context: DiagnosticContext): NumericInterval {
  if (state.storyOrder !== null) return { start: state.storyOrder, end: state.storyOrder };
  return {
    start:
      state.validFromOrder ??
      (state.validFromSceneId ? sceneRank(context, state.validFromSceneId) : Number.NEGATIVE_INFINITY),
    end:
      state.validToOrder ??
      (state.validToSceneId ? sceneRank(context, state.validToSceneId) : Number.POSITIVE_INFINITY)
  };
}

function intervalsOverlap(left: NumericInterval, right: NumericInterval): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function currentStateAt(
  states: EntityState[],
  order: number,
  context: DiagnosticContext
): EntityState | null {
  return (
    states
      .filter((state) => {
        const start = stateCurrentStart(state, context);
        const end = stateCurrentEnd(state, context);
        return start <= order && order <= end;
      })
      .sort((left, right) => stateCurrentStart(right, context) - stateCurrentStart(left, context))[0] ?? null
  );
}

function stateCurrentStart(state: EntityState, context: DiagnosticContext): number {
  return (
    state.validFromOrder ??
    (state.validFromSceneId ? sceneRank(context, state.validFromSceneId) : null) ??
    state.storyOrder ??
    Number.NEGATIVE_INFINITY
  );
}

function stateCurrentEnd(state: EntityState, context: DiagnosticContext): number {
  return (
    state.validToOrder ??
    (state.validToSceneId ? sceneRank(context, state.validToSceneId) : Number.POSITIVE_INFINITY)
  );
}

function isDeadValue(value: JsonValue, stateKey: string): boolean {
  if (/alive/.test(normalizeKey(stateKey)) && value === false) return true;
  const normalized = normalizeKey(jsonString(value) ?? '');
  return ['dead', 'deceased', 'killed'].includes(normalized) || value === true && /dead/.test(normalizeKey(stateKey));
}

function normalizeColor(value: string): string {
  return value.toLocaleLowerCase('en-US') === 'grey' ? 'gray' : value.toLocaleLowerCase('en-US');
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/[\s_]+/g, '-');
}

function sceneRank(context: DiagnosticContext, sceneId: string): number {
  return context.sceneOrder.get(sceneId) ?? Number.MAX_SAFE_INTEGER;
}

function characterName(context: DiagnosticContext, characterId: string | null): string {
  if (!characterId) return 'no character';
  return context.characterById.get(characterId)?.name ?? `character “${characterId}”`;
}

function locationName(context: DiagnosticContext, locationId: string): string {
  return context.locationById.get(locationId)?.name ?? `location “${locationId}”`;
}

function eventEvidence(event: {
  sourceSpan: StorySourceSpan | null;
  chapterId: string | null;
  sceneId: string | null;
  sourceArtifactId: string | null;
}): StorySourceSpan[] {
  const evidence = sourceEvidence(event);
  return evidence ? [evidence] : [];
}

function buildTravelMap(rules: TravelTimeRule[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const rule of rules) {
    if (!Number.isFinite(rule.minimumMinutes) || rule.minimumMinutes < 0) continue;
    const direct = `${rule.fromLocationId}->${rule.toLocationId}`;
    map.set(direct, Math.max(map.get(direct) ?? 0, rule.minimumMinutes));
    if (rule.bidirectional) {
      const reverse = `${rule.toLocationId}->${rule.fromLocationId}`;
      map.set(reverse, Math.max(map.get(reverse) ?? 0, rule.minimumMinutes));
    }
  }
  return map;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${Math.max(0, Math.round(value))} minutes`;
  if (value % 1_440 === 0) return `${value / 1_440} days`;
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} hours`;
}

function characterBibleKnowledge(context: DiagnosticContext): Set<string> {
  const result = new Set<string>();
  const characterByKey = new Map<string, string>();
  for (const character of context.input.characters) {
    characterByKey.set(normalizeKey(character.id), character.id);
    characterByKey.set(normalizeKey(character.key ?? ''), character.id);
    characterByKey.set(normalizeKey(character.name), character.id);
  }
  for (const artifact of context.activeArtifacts.filter(
    (value) => value.type === 'character-bible' && isJsonObject(value.content)
  )) {
    const content = artifact.content as JsonObject;
    const characterKey = jsonString(content.characterKey) ?? artifact.key;
    const characterId = characterByKey.get(normalizeKey(characterKey));
    if (!characterId) continue;
    for (const knowledge of stringArray(content.knowledge)) {
      result.add(knowledgeSlot(characterId, knowledge));
    }
  }
  return result;
}

function canonicalKnowledge(context: DiagnosticContext): Map<string, NumericInterval[]> {
  const result = new Map<string, NumericInterval[]>();
  for (const fact of context.input.canonFacts.filter(
    (value) =>
      value.isCurrent &&
      value.status === 'canonical' &&
      value.invalidatedAt === null &&
      /know|learn|aware/.test(normalizeKey(value.predicate))
  )) {
    const values = Array.isArray(fact.object)
      ? fact.object.flatMap((value) => {
          const parsed = jsonString(value);
          return parsed ? [parsed] : [];
        })
      : [jsonString(fact.object)].filter((value): value is string => Boolean(value));
    for (const knowledge of values) {
      const slot = knowledgeSlot(fact.subjectId, knowledge);
      result.set(slot, [...(result.get(slot) ?? []), factInterval(fact, context)]);
    }
  }
  return result;
}

function sceneKnowledgeDeltas(scene: DiagnosticSceneSnapshot): DiagnosticKnowledgeDelta[] {
  const result = [...(scene.normalizedKnowledgeDeltas ?? [])];
  const raw = scene.knowledgeDeltas;
  const append = (value: JsonValue, defaultOperation: 'gain' | 'lose' = 'gain') => {
    if (!isJsonObject(value)) return;
    const characterId = jsonString(value.characterId) ?? jsonString(value.character);
    const knowledgeKey =
      jsonString(value.knowledgeKey) ?? jsonString(value.factKey) ?? jsonString(value.knowledge);
    const operationText = normalizeKey(jsonString(value.operation) ?? jsonString(value.op) ?? defaultOperation);
    if (!characterId || !knowledgeKey) return;
    result.push({
      characterId,
      knowledgeKey,
      operation: /lose|forget|remove/.test(operationText) ? 'lose' : 'gain'
    });
  };
  if (Array.isArray(raw)) raw.forEach((value) => append(value));
  else if (isJsonObject(raw)) {
    for (const key of ['gained', 'learned', 'added']) {
      const values = raw[key];
      if (Array.isArray(values)) values.forEach((value) => append(value, 'gain'));
    }
    for (const key of ['lost', 'forgotten', 'removed']) {
      const values = raw[key];
      if (Array.isArray(values)) values.forEach((value) => append(value, 'lose'));
    }
  }
  return uniqueBy(result, (value) => `${value.characterId}:${value.knowledgeKey}:${value.operation}`);
}

interface ParsedObjectTransfer {
  objectId: string;
  fromOwnerId: string;
  toOwnerId: string;
}

function sceneObjectTransfers(scene: DiagnosticSceneSnapshot): ParsedObjectTransfer[] {
  const candidates: JsonValue[] = Array.isArray(scene.objectTransfers)
    ? scene.objectTransfers
    : isJsonObject(scene.objectTransfers) && Array.isArray(scene.objectTransfers.transfers)
      ? scene.objectTransfers.transfers
      : isJsonObject(scene.objectTransfers)
        ? [scene.objectTransfers]
        : [];
  const result: ParsedObjectTransfer[] = [];
  for (const candidate of candidates) {
    if (!isJsonObject(candidate)) continue;
    const objectId =
      jsonString(candidate.objectId) ?? jsonString(candidate.itemId) ?? jsonString(candidate.entityId);
    const fromOwnerId =
      jsonString(candidate.fromOwnerId) ??
      jsonString(candidate.fromCharacterId) ??
      jsonString(candidate.from);
    const toOwnerId =
      jsonString(candidate.toOwnerId) ??
      jsonString(candidate.toCharacterId) ??
      jsonString(candidate.to);
    if (objectId && fromOwnerId && toOwnerId) result.push({ objectId, fromOwnerId, toOwnerId });
  }
  return uniqueBy(
    result,
    (transfer) => `${transfer.objectId}:${transfer.fromOwnerId}:${transfer.toOwnerId}`
  );
}

function sceneKnowledgeClaims(scene: DiagnosticSceneSnapshot): DiagnosticKnowledgeClaim[] {
  const result = [...(scene.knowledgeClaims ?? [])];
  const raw = scene.knowledgeDeltas;
  if (isJsonObject(raw) && Array.isArray(raw.claims)) {
    for (const value of raw.claims) {
      if (!isJsonObject(value)) continue;
      const characterId = jsonString(value.characterId) ?? jsonString(value.character);
      const knowledgeKey =
        jsonString(value.knowledgeKey) ?? jsonString(value.factKey) ?? jsonString(value.knowledge);
      if (!characterId || !knowledgeKey) continue;
      result.push({
        characterId,
        knowledgeKey,
        ...(typeof value.quote === 'string' ? { quote: value.quote } : {}),
        ...(typeof value.start === 'number' ? { start: value.start } : {}),
        ...(typeof value.end === 'number' ? { end: value.end } : {})
      });
    }
  }
  return uniqueBy(result, (value) => `${value.characterId}:${value.knowledgeKey}:${value.start ?? ''}`);
}

function knowledgeSlot(characterId: string, knowledgeKey: string): string {
  return `${normalizeKey(characterId)}:${normalizeKey(knowledgeKey)}`;
}

function worldRuleReferences(value: JsonValue | null): string[] {
  if (Array.isArray(value)) {
    return uniqueBy(
      value.flatMap((entry) => {
        const parsed = jsonString(entry);
        return parsed ? [parsed] : [];
      }),
      normalizeKey
    );
  }
  if (!isJsonObject(value)) return [];
  const candidates = [value.refs, value.rules, value.keys];
  return uniqueBy(candidates.flatMap(stringArray), normalizeKey);
}

function narrativeContractPovRules(context: DiagnosticContext): {
  mode?: 'single' | 'multiple' | 'omniscient';
  person?: 'first' | 'second' | 'third';
  tense?: 'past' | 'present';
  narrativeDistance?: string;
  allowedCharacterIds?: string[];
  requiredCharacterId?: string;
  singlePovPerChapter?: boolean;
} {
  const artifact = context.activeArtifacts.find(
    (value) => value.type === 'narrative-contract' && isJsonObject(value.content)
  );
  if (!artifact) return {};
  const content = artifact.content as JsonObject;
  const pov = normalizeText(jsonString(content.pov) ?? '');
  const tense = normalizeText(jsonString(content.tense) ?? '');
  const narrativeDistance = jsonString(content.narrativeDistance) ?? undefined;
  return {
    mode: pov.includes('omniscient') ? 'omniscient' : pov.includes('single') ? 'single' : undefined,
    person: pov.includes('first')
      ? 'first'
      : pov.includes('second')
        ? 'second'
        : pov.includes('third')
          ? 'third'
          : undefined,
    tense: tense.includes('present') ? 'present' : tense.includes('past') ? 'past' : undefined,
    narrativeDistance
  };
}

function linkedEvidence(
  sceneId: string | null,
  artifactId: string | null,
  context: DiagnosticContext
): StorySourceSpan[] {
  const evidence: StorySourceSpan[] = [];
  if (sceneId && context.sceneById.has(sceneId)) evidence.push(sceneEvidence(context.sceneById.get(sceneId)!));
  if (artifactId) evidence.push(artifactEvidence(artifactId));
  return evidence;
}

function linkedOrder(sceneId: string | null, context: DiagnosticContext): number | null {
  if (!sceneId) return null;
  return context.sceneOrder.get(sceneId) ?? null;
}

interface PlannedDependency {
  id: string;
  key: string;
  title: string;
  order: number;
  dependencyIds: string[];
  evidence: StorySourceSpan[];
  refs: StoryReference[];
}

function sceneDependencies(context: DiagnosticContext): PlannedDependency[] {
  const planById = new Map(context.activeArtifacts.filter((artifact) => artifact.type === 'scene-plan').map((artifact) => [artifact.id, artifact]));
  const live = context.scenes.map((scene, index) => {
    const plan = scene.sourceArtifactId ? planById.get(scene.sourceArtifactId) : undefined;
    const planContent = plan && isJsonObject(plan.content) ? plan.content as JsonObject : undefined;
    const key = jsonString(scene.metadata?.sceneKey) ?? (planContent ? jsonString(planContent.sceneKey) : null) ?? plan?.key ?? scene.id;
    return {
      id: scene.id,
      key,
      title: scene.title,
      order: index,
      dependencyIds: scene.dependencyIds ?? [],
      evidence: [sceneEvidence(scene)],
      refs: [sceneReference(scene)]
    };
  });
  const seenKeys = new Set(live.flatMap((item) => [item.id, item.key]));
  const plans = context.activeArtifacts
    .filter((artifact) => artifact.type === 'scene-plan' && isJsonObject(artifact.content))
    .flatMap((artifact, index) => {
      const content = artifact.content as JsonObject;
      const key = jsonString(content.sceneKey) ?? artifact.key;
      if (seenKeys.has(key)) return [];
      return [
        {
          id: artifact.id,
          key,
          title: jsonString(content.title) ?? artifact.title,
          order:
            typeof content.ordinal === 'number' && Number.isFinite(content.ordinal)
              ? content.ordinal
              : context.scenes.length + index,
          dependencyIds: stringArray(content.dependencies),
          evidence: [artifactEvidence(artifact.id)],
          refs: [reference('artifact', artifact.id, artifact.key, artifact.title)]
        }
      ];
    });
  return [...live, ...plans].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function findEvidenceAt(
  unit: ReturnType<typeof proseUnits>[number],
  quote: string,
  start: number
): StorySourceSpan {
  const details = { quote, start, end: start + quote.length };
  return unit.scene ? sceneEvidence(unit.scene, details) : chapterEvidence(unit.chapter, details);
}
