import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  BuildObservability,
  FindStoryReferencesInput,
  JsonValue,
  ListStoryArtifactsInput,
  PaginatedStoryArtifacts,
  SearchStoryInput,
  StoryReferenceHit,
  StorySearchHit,
  StoryStateSnapshot
  ,StoryStateDelta
  ,StoryStateEntityKind
  ,StoryStateHistoryResult
  ,TemporalStoryStateQuery
  ,TemporalStoryStateResult
} from '@opentales/sdk';
import { HttpError } from '../http/HttpError.js';
import {
  toBuildCheckpoint,
  toBuildDirective,
  toBuildEvaluation,
  toBuildTrace,
  toCanonFact,
  toEntityState,
  toOpenLoop,
  toPlotThread,
  toPrismaArtifactStatus,
  toPrismaArtifactType,
  toSetupPayoff,
  toStoryArtifact,
  toTimelineEvent
} from '../useCases/novelBuild/novelBuildMapper.js';

interface RawSearchRow {
  kind: string;
  id: string;
  key: string | null;
  title: string;
  snippet: string;
  score: number;
  ref: Prisma.JsonValue;
  source_span: Prisma.JsonValue | null;
  absolute_start: number | null;
  line_start: number | null;
  total: bigint;
}

interface RawReferenceRow extends Omit<RawSearchRow, 'score' | 'total' | 'absolute_start' | 'line_start'> {
  path: string;
  relationship: string;
  total: bigint;
  absolute_start: number | null;
  line_start: number | null;
}

interface RawDeltaRow { kind: string; id: string; updated_at: Date; total: bigint }

export class StoryStateRepository {
  constructor(readonly prisma: PrismaClient) {}

  async snapshot(projectId: string, buildRunId: string): Promise<StoryStateSnapshot> {
    const [canonFacts, entityStates, timelineEvents, openLoops, setupPayoffs, plotThreads] = await Promise.all([
      this.prisma.canonFact.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.entityState.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: [{ storyOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.timelineEvent.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.openLoop.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.setupPayoffLink.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.plotThread.findMany({ where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null }, orderBy: { createdAt: 'asc' } })
    ]);
    return {
      projectId,
      buildRunId,
      canonFacts: canonFacts.map(toCanonFact),
      entityStates: entityStates.map(toEntityState),
      timelineEvents: timelineEvents.map(toTimelineEvent),
      openLoops: openLoops.map(toOpenLoop),
      setupPayoffs: setupPayoffs.map(toSetupPayoff),
      plotThreads: plotThreads.map(toPlotThread)
    };
  }

  async delta(
    projectId: string,
    buildRunId: string,
    input: { sinceUpdatedAt?: string; limit?: number; offset?: number }
  ): Promise<StoryStateDelta> {
    const limit = clamp(input.limit, 1, 500, 100);
    const offset = clamp(input.offset, 0, 1_000_000, 0);
    const since = input.sinceUpdatedAt ? new Date(input.sinceUpdatedAt) : null;
    if (since && Number.isNaN(since.valueOf())) throw new HttpError(400, 'sinceUpdatedAt must be an ISO date');
    const sinceFilter = since ? Prisma.sql`AND "updatedAt" > ${since}` : Prisma.empty;
    const page = await this.prisma.$queryRaw<RawDeltaRow[]>(Prisma.sql`
      WITH changed AS (
        SELECT 'canon-fact'::text kind, id, "updatedAt" updated_at FROM "CanonFact" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
        UNION ALL SELECT 'entity-state', id, "updatedAt" FROM "EntityState" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
        UNION ALL SELECT 'timeline-event', id, "updatedAt" FROM "TimelineEvent" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
        UNION ALL SELECT 'open-loop', id, "updatedAt" FROM "OpenLoop" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
        UNION ALL SELECT 'setup-payoff', id, "updatedAt" FROM "SetupPayoffLink" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
        UNION ALL SELECT 'plot-thread', id, "updatedAt" FROM "PlotThread" WHERE "projectId"=${projectId} AND "buildRunId"=${buildRunId} ${sinceFilter}
      )
      SELECT kind, id, updated_at, count(*) OVER() total
      FROM changed ORDER BY updated_at ASC, kind ASC, id ASC LIMIT ${limit} OFFSET ${offset}
    `);
    const ids = (kind: string) => page.filter((row) => row.kind === kind).map((row) => row.id);
    const [canonFacts, entityStates, timelineEvents, openLoops, setupPayoffs, plotThreads] = await Promise.all([
      ids('canon-fact').length ? this.prisma.canonFact.findMany({ where: { id: { in: ids('canon-fact') } } }) : [],
      ids('entity-state').length ? this.prisma.entityState.findMany({ where: { id: { in: ids('entity-state') } } }) : [],
      ids('timeline-event').length ? this.prisma.timelineEvent.findMany({ where: { id: { in: ids('timeline-event') } } }) : [],
      ids('open-loop').length ? this.prisma.openLoop.findMany({ where: { id: { in: ids('open-loop') } } }) : [],
      ids('setup-payoff').length ? this.prisma.setupPayoffLink.findMany({ where: { id: { in: ids('setup-payoff') } } }) : [],
      ids('plot-thread').length ? this.prisma.plotThread.findMany({ where: { id: { in: ids('plot-thread') } } }) : []
    ]);
    const order = new Map(page.map((row, index) => [row.id, index]));
    const byPage = <T extends { id: string }>(values: T[]) => values.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    const total = page[0] ? Number(page[0].total) : 0;
    return {
      projectId,
      buildRunId,
      generatedAt: new Date().toISOString(),
      sinceUpdatedAt: since?.toISOString() ?? null,
      nextOffset: offset + page.length < total ? offset + page.length : null,
      canonFacts: byPage(canonFacts).map(toCanonFact),
      entityStates: byPage(entityStates).map(toEntityState),
      timelineEvents: byPage(timelineEvents).map(toTimelineEvent),
      openLoops: byPage(openLoops).map(toOpenLoop),
      setupPayoffs: byPage(setupPayoffs).map(toSetupPayoff),
      plotThreads: byPage(plotThreads).map(toPlotThread)
    };
  }

  async history(
    projectId: string,
    buildRunId: string,
    entityKind: StoryStateEntityKind,
    key: string
  ): Promise<StoryStateHistoryResult> {
    const normalized = key.trim();
    if (!normalized) throw new HttpError(400, 'History key is required');
    const versions = entityKind === 'canon-fact' ? (await this.prisma.canonFact.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toCanonFact)
      : entityKind === 'entity-state' ? (await this.prisma.entityState.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toEntityState)
      : entityKind === 'timeline-event' ? (await this.prisma.timelineEvent.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toTimelineEvent)
      : entityKind === 'open-loop' ? (await this.prisma.openLoop.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toOpenLoop)
      : entityKind === 'setup-payoff' ? (await this.prisma.setupPayoffLink.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toSetupPayoff)
      : (await this.prisma.plotThread.findMany({ where: { projectId, buildRunId, key: normalized }, orderBy: { version: 'asc' } })).map(toPlotThread);
    if (!versions.length) throw new HttpError(404, 'Story-state history not found');
    return { entityKind, key: normalized, versions };
  }

  async temporal(
    projectId: string,
    buildRunId: string,
    input: TemporalStoryStateQuery
  ): Promise<TemporalStoryStateResult> {
    const limit = clamp(input.limit, 1, 500, 100);
    const offset = clamp(input.offset, 0, 1_000_000, 0);
    const storyOrder = input.storyOrder ?? await this.resolveStoryOrder(projectId, buildRunId, input.sceneId);
    const interval = storyOrder === null ? {} : {
      AND: [
        { OR: [{ validFromOrder: null }, { validFromOrder: { lte: storyOrder } }] },
        { OR: [{ validToOrder: null }, { validToOrder: { gte: storyOrder } }] }
      ]
    };
    const [canonFacts, states, timelineRows] = await Promise.all([
      this.prisma.canonFact.findMany({
        where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null, ...interval,
          ...(input.entityType ? { subjectType: input.entityType } : {}), ...(input.entityId ? { subjectId: input.entityId } : {}),
          ...(input.predicate ? { predicate: input.predicate } : {}) },
        orderBy: [{ validFromOrder: 'asc' }, { version: 'desc' }]
      }),
      this.prisma.entityState.findMany({
        where: { projectId, buildRunId, isCurrent: true, invalidatedAt: null, ...interval,
          ...(input.entityType ? { entityType: input.entityType } : {}), ...(input.entityId ? { entityId: input.entityId } : {}),
          ...(input.stateKey ? { stateKey: input.stateKey } : {}) },
        orderBy: [{ validFromOrder: 'asc' }, { storyOrder: 'asc' }, { version: 'desc' }]
      }),
      this.temporalTimelineIds(projectId, buildRunId, storyOrder, input.participantId, limit, offset)
    ]);
    const timelineEvents = timelineRows.ids.length
      ? await this.prisma.timelineEvent.findMany({ where: { id: { in: timelineRows.ids } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
      : [];
    return {
      storyOrder,
      canonFacts: canonFacts.map(toCanonFact),
      entityStates: latestEntityStates(states).map(toEntityState),
      timelineEvents: timelineEvents.map(toTimelineEvent),
      totalTimelineEvents: timelineRows.total,
      nextTimelineOffset: offset + timelineEvents.length < timelineRows.total ? offset + timelineEvents.length : null
    };
  }

  private async resolveStoryOrder(projectId: string, buildRunId: string, sceneId?: string): Promise<number | null> {
    if (!sceneId) return null;
    const unit = await this.prisma.buildManuscriptUnit.findFirst({
      where: { projectId, buildRunId, OR: [{ id: sceneId }, { sourceSceneId: sceneId }], kind: 'SCENE' },
      include: { parentUnit: { select: { order: true } } }
    });
    if (unit) return (unit.parentUnit?.order ?? 0) * 10_000 + unit.order;
    const scene = await this.prisma.scene.findFirst({ where: { id: sceneId, chapter: { projectId, deletedAt: null } }, include: { chapter: { select: { number: true } } } });
    if (!scene) throw new HttpError(404, 'Temporal scene not found in project/build');
    return scene.chapter.number * 10_000 + scene.order;
  }

  private async temporalTimelineIds(
    projectId: string,
    buildRunId: string,
    storyOrder: number | null,
    participantId: string | undefined,
    limit: number,
    offset: number
  ): Promise<{ ids: string[]; total: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
      SELECT event.id, count(*) OVER() AS total
      FROM "TimelineEvent" event
      WHERE event."projectId" = ${projectId}
        AND event."buildRunId" = ${buildRunId}
        AND event."isCurrent" = true
        AND event."invalidatedAt" IS NULL
        ${storyOrder === null ? Prisma.empty : Prisma.sql`AND (event."sortOrder" IS NULL OR event."sortOrder" <= ${storyOrder})`}
        ${participantId ? Prisma.sql`AND jsonb_path_exists(event."participantRefs", '$.** ? (@.id == $id)', jsonb_build_object('id', to_jsonb(${participantId}::text)))` : Prisma.empty}
      ORDER BY event."sortOrder" ASC NULLS LAST, event."createdAt" ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return { ids: rows.map((row) => row.id), total: rows[0] ? Number(rows[0].total) : 0 };
  }

  async listArtifacts(
    projectId: string,
    buildRunId: string,
    input: ListStoryArtifactsInput
  ): Promise<PaginatedStoryArtifacts> {
    const limit = clamp(input.limit, 1, 500, 50);
    const offset = clamp(input.offset, 0, 1_000_000, 0);
    const where: Prisma.StoryArtifactWhereInput = {
      projectId,
      buildRunId,
      ...(input.types?.length ? { type: { in: input.types.map(toPrismaArtifactType) } } : {}),
      ...(input.statuses?.length ? { status: { in: input.statuses.map(toPrismaArtifactStatus) } } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {})
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.storyArtifact.count({ where }),
      this.prisma.storyArtifact.findMany({
        where,
        orderBy: [{ type: 'asc' }, { key: 'asc' }, { version: 'desc' }],
        skip: offset,
        take: limit
      })
    ]);
    return { items: items.map(toStoryArtifact), total, limit, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
  }

  async observability(
    projectId: string,
    buildRunId: string,
    input: { taskId?: string; limit?: number; offset?: number }
  ): Promise<BuildObservability> {
    const limit = clamp(input.limit, 1, 500, 100);
    const offset = clamp(input.offset, 0, 1_000_000, 0);
    const taskFilter = input.taskId ? { taskId: input.taskId } : {};
    const [traces, evaluations, checkpoints, directives] = await Promise.all([
      this.prisma.buildTrace.findMany({ where: { projectId, buildRunId, ...taskFilter }, orderBy: { startedAt: 'desc' }, skip: offset, take: limit }),
      this.prisma.buildEvaluationResult.findMany({ where: { projectId, buildRunId, ...taskFilter }, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }),
      this.prisma.buildCheckpoint.findMany({ where: { projectId, buildRunId, ...taskFilter }, orderBy: { sequence: 'desc' }, skip: offset, take: limit }),
      this.prisma.buildDirective.findMany({
        where: { projectId, buildRunId, ...(input.taskId ? { fromTaskId: input.taskId } : {}) },
        orderBy: { createdAt: 'desc' }, skip: offset, take: limit
      })
    ]);
    return {
      projectId,
      buildRunId,
      traces: traces.map(toBuildTrace),
      evaluations: evaluations.map(toBuildEvaluation),
      checkpoints: checkpoints.map(toBuildCheckpoint),
      directives: directives.map(toBuildDirective)
    };
  }

  async search(
    projectId: string,
    buildRunId: string,
    input: Required<Pick<SearchStoryInput, 'query' | 'strategy' | 'limit' | 'offset'>> & SearchStoryInput
  ): Promise<{ hits: StorySearchHit[]; total: number }> {
    const kinds = input.kinds ?? [];
    const fields = input.fields ?? [];
    const statuses = input.statuses ?? [];
    const artifactTypes = input.artifactTypes ?? [];
    const structuredFilters = Object.entries(input.filters ?? {}).flatMap(([key, values]) => {
      const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
      if (!normalized.length) return [];
      if (key === 'after' || key === 'before') {
        const positions = normalized.map((value) => Number(value.match(/(?:^|[-_\s])(\d+(?:\.\d+)?)$/)?.[1] ?? value)).filter(Number.isFinite);
        if (!positions.length) return [Prisma.sql`AND false`];
        const boundary = key === 'after' ? Math.min(...positions) : Math.max(...positions);
        return [key === 'after'
          ? Prisma.sql`AND CASE WHEN jsonb_typeof(search_fields->'order') = 'number' THEN (search_fields->>'order')::double precision > ${boundary} ELSE false END`
          : Prisma.sql`AND CASE WHEN jsonb_typeof(search_fields->'order') = 'number' THEN (search_fields->>'order')::double precision < ${boundary} ELSE false END`];
      }
      return [Prisma.sql`AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(CASE
          WHEN jsonb_typeof(search_fields -> ${key}) = 'array' THEN search_fields -> ${key}
          WHEN search_fields ? ${key} THEN jsonb_build_array(search_fields -> ${key})
          ELSE '[]'::jsonb
        END) AS filter_value(value)
        WHERE lower(filter_value.value) IN (${Prisma.join(normalized)})
      )`];
    });
    const kindFilter = kinds.length ? Prisma.sql`AND kind IN (${Prisma.join(kinds)})` : Prisma.empty;
    const fieldFilter = fields.length ? Prisma.sql`AND field_name IN (${Prisma.join(fields)})` : Prisma.empty;
    const statusFilter = statuses.length ? Prisma.sql`AND status IN (${Prisma.join(statuses)})` : Prisma.empty;
    const artifactFilter = artifactTypes.length ? Prisma.sql`AND artifact_type IN (${Prisma.join(artifactTypes)})` : Prisma.empty;
    const structuredFilter = structuredFilters.length ? Prisma.join(structuredFilters, ' ') : Prisma.empty;
    const caseSensitive = input.caseSensitive === true;
    const textExpression = caseSensitive ? Prisma.sql`search_text` : Prisma.sql`lower(search_text)`;
    const queryExpression = caseSensitive ? Prisma.sql`${input.query}` : Prisma.sql`lower(${input.query})`;
    const sourceTextExpression = caseSensitive ? Prisma.sql`source.source_body` : Prisma.sql`lower(source.source_body)`;
    const sourceMatchPosition = Prisma.sql`position(${queryExpression} in ${sourceTextExpression})`;
    let match: Prisma.Sql;
    let score: Prisma.Sql;
    if (input.strategy === 'regex') {
      match = caseSensitive ? Prisma.sql`search_text ~ ${input.query}` : Prisma.sql`search_text ~* ${input.query}`;
      score = Prisma.sql`1.0::double precision`;
    } else if (input.strategy === 'exact') {
      match = Prisma.sql`position(${queryExpression} in ${textExpression}) > 0`;
      score = Prisma.sql`2.0::double precision`;
    } else if (input.strategy === 'fts') {
      match = Prisma.sql`document @@ websearch_to_tsquery('english', ${input.query})`;
      score = Prisma.sql`ts_rank_cd(document, websearch_to_tsquery('english', ${input.query}))::double precision`;
    } else {
      match = Prisma.sql`(document @@ websearch_to_tsquery('english', ${input.query}) OR position(${queryExpression} in ${textExpression}) > 0)`;
      score = Prisma.sql`(ts_rank_cd(document, websearch_to_tsquery('english', ${input.query})) + CASE WHEN position(${queryExpression} in ${textExpression}) > 0 THEN 1 ELSE 0 END)::double precision`;
    }
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2000ms'");
      return tx.$queryRaw<RawSearchRow[]>(Prisma.sql`
        WITH corpus AS (
          SELECT 'chapter'::text kind, c.id, NULL::text key, c.title,
            concat_ws(' ', c.title, c.summary, v.body) search_text,
            'content'::text field_name,
            jsonb_build_object(
              'type', jsonb_build_array('chapter'), 'chapter', jsonb_build_array(c.id, c.number::text, c.title), 'order', c.number,
              'pov', jsonb_build_array(c."povCharacterId", pc.name), 'location', jsonb_build_array(c."locationId", loc.name),
              'status', jsonb_build_array(lower(replace(c.status::text, '_', '-')))
            ) search_fields,
            lower(replace(c.status::text, '_', '-')) status,
            NULL::text artifact_type,
            jsonb_build_object('type','chapter','id',c.id,'label',c.title) ref,
            jsonb_build_object('chapterId',c.id,'branchId',b.id,'writingVersionId',v.id) source_span
          FROM "Chapter" c
          JOIN "Writing" w ON w.id = c."bodyWritingId"
          LEFT JOIN "WritingBranch" b ON b.id = w."defaultBranchId"
          LEFT JOIN "WritingVersion" v ON v.id = b."headVersionId"
          LEFT JOIN "Character" pc ON pc.id = c."povCharacterId"
          LEFT JOIN "Location" loc ON loc.id = c."locationId"
          WHERE c."projectId" = ${projectId} AND c."deletedAt" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "BuildManuscriptUnit" bu WHERE bu."buildRunId"=${buildRunId} AND bu.kind='CHAPTER' AND bu."invalidatedAt" IS NULL)
          UNION ALL
          SELECT 'scene', s.id, NULL, coalesce(s.title, 'Untitled scene'),
            concat_ws(' ', s.title, s.summary, s."sceneFunction", s.goal, s.obstacle, s.stakes, s.conflict, s.turn, s.revelation, s.outcome, s."emotionalValueShift", s."writerNotes", s."aiNotes", v.body),
            'content',
            jsonb_build_object(
              'type', jsonb_build_array('scene'), 'chapter', jsonb_build_array(s."chapterId", c.number::text, c.title),
              'scene', jsonb_build_array(s.id, s.order::text, coalesce(s.title,'')), 'order', (c.number::double precision + ((s.order + 1)::double precision / 1000.0)),
              'pov', jsonb_build_array(s."povCharacterId", pc.name), 'location', jsonb_build_array(s."locationId", loc.name),
              'scene.goal', jsonb_build_array(coalesce(s.goal,'')),
              'thread', to_jsonb(s."plotThreadIds") || coalesce((SELECT jsonb_agg(value) FROM (SELECT pt.key value FROM "PlotThread" pt WHERE pt.id = ANY(s."plotThreadIds") UNION ALL SELECT pt.title FROM "PlotThread" pt WHERE pt.id = ANY(s."plotThreadIds")) thread_values), '[]'::jsonb),
              'setup', to_jsonb(s."setupPayoffIds"), 'status', jsonb_build_array(lower(replace(s.status::text, '_', '-')))
            ), lower(replace(s.status::text, '_', '-')), NULL,
            jsonb_build_object('type','scene','id',s.id,'label',coalesce(s.title,'Untitled scene')),
            jsonb_build_object('chapterId',s."chapterId",'sceneId',s.id,'branchId',b.id,'writingVersionId',v.id)
          FROM "Scene" s
          JOIN "Chapter" c ON c.id = s."chapterId"
          JOIN "Writing" w ON w.id = s."bodyWritingId"
          LEFT JOIN "WritingBranch" b ON b.id = w."defaultBranchId"
          LEFT JOIN "WritingVersion" v ON v.id = b."headVersionId"
          LEFT JOIN "Character" pc ON pc.id = s."povCharacterId"
          LEFT JOIN "Location" loc ON loc.id = s."locationId"
          WHERE c."projectId" = ${projectId} AND c."deletedAt" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "BuildManuscriptUnit" bu WHERE bu."buildRunId"=${buildRunId} AND bu.kind='SCENE' AND bu."invalidatedAt" IS NULL)
          UNION ALL
          SELECT 'artifact', a.id, a.key, a.title, concat_ws(' ', a.title, a.content::text),
            'artifact', jsonb_build_object(
              'type', jsonb_build_array('artifact', lower(replace(a.type::text, '_', '-'))),
              'status', jsonb_build_array(lower(replace(a.status::text, '_', '-'))),
              'chapter', jsonb_build_array(coalesce(a.content->>'chapterKey','')),
              'scene', jsonb_build_array(coalesce(a.content->>'sceneKey','')),
              'order', coalesce(a.content->'number', a.content->'ordinal', 'null'::jsonb),
              'thread', jsonb_build_array(coalesce(a.content->>'threadKey', CASE WHEN a.type='PLOT_THREAD' THEN a.key ELSE '' END)),
              'entity', jsonb_build_array(coalesce(a.content->>'characterKey','')),
              'severity', jsonb_build_array(coalesce(a.content->>'severity','')),
              'category', jsonb_build_array(coalesce(a.content->>'category','')),
              'pass', jsonb_build_array(coalesce(a.content->>'pass',''))
            ), lower(replace(a.status::text, '_', '-')), lower(replace(a.type::text, '_', '-')),
            jsonb_build_object('type','artifact','id',a.id,'key',a.key,'label',a.title),
            jsonb_build_object('artifactId',a.id)
          FROM "StoryArtifact" a WHERE a."projectId" = ${projectId} AND a."buildRunId" = ${buildRunId}
            AND a.status IN ('DRAFT','VALIDATED','ACCEPTED') AND a."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'canon-fact', f.id, f.key, concat_ws(' ', f."subjectId", f.predicate), concat_ws(' ', f."subjectType", f."subjectId", f.predicate, f.object::text),
            'fact', jsonb_build_object(
              'type', jsonb_build_array('canon-fact'), 'entity', jsonb_build_array(f."subjectId", f."subjectType"),
              'knows', CASE WHEN f.predicate='knows' THEN jsonb_build_array(f.object#>>'{}') ELSE '[]'::jsonb END,
              'scene', jsonb_build_array(f."sourceSceneId", f."validFromSceneId"),
              'chapter', jsonb_build_array(f."sourceChapterId"), 'status', jsonb_build_array(lower(replace(f.status::text, '_', '-')))
            ), lower(replace(f.status::text, '_', '-')), NULL,
            jsonb_build_object('type','canon-fact','id',f.id,'key',f.key), f."sourceSpan"
          FROM "CanonFact" f WHERE f."projectId" = ${projectId} AND f."buildRunId" = ${buildRunId} AND f."isCurrent"=true AND f."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'entity-state', e.id, e.key, concat_ws(' ', e."entityId", e."stateKey"), concat_ws(' ', e."entityType", e."entityId", e."stateKey", e.value::text),
            'state', jsonb_build_object(
              'type', jsonb_build_array('entity-state'), 'entity', jsonb_build_array(e."entityId", e."entityType"),
              'scene', jsonb_build_array(e."validFromSceneId", e."validToSceneId"),
              'status', jsonb_build_array(lower(replace(e.status::text, '_', '-')))
            ), lower(replace(e.status::text, '_', '-')), NULL,
            jsonb_build_object('type','entity-state','id',e.id,'key',e.key), e."sourceSpan"
          FROM "EntityState" e WHERE e."projectId" = ${projectId} AND e."buildRunId" = ${buildRunId} AND e."isCurrent"=true AND e."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'timeline-event', t.id, t.key, t.title, concat_ws(' ', t.title, t.description, t.chronology::text, t."participantRefs"::text),
            'timeline', jsonb_build_object(
              'type', jsonb_build_array('timeline-event'), 'chapter', jsonb_build_array(t."chapterId"),
              'scene', jsonb_build_array(t."sceneId"), 'order', to_jsonb(t."sortOrder"), 'status', jsonb_build_array(CASE WHEN t."invalidatedAt" IS NULL THEN 'active' ELSE 'invalidated' END)
            ), CASE WHEN t."invalidatedAt" IS NULL THEN 'active' ELSE 'invalidated' END, NULL,
            jsonb_build_object('type','timeline-event','id',t.id,'key',t.key,'label',t.title), t."sourceSpan"
          FROM "TimelineEvent" t WHERE t."projectId" = ${projectId} AND t."buildRunId" = ${buildRunId} AND t."isCurrent"=true AND t."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'open-loop', o.id, o.key, o.title, concat_ws(' ', o.title, o.description, o."targetPayoff", o.metadata::text),
            'loop', jsonb_build_object(
              'type', jsonb_build_array('open-loop'), 'setup', jsonb_build_array(o.key, o.title, lower(replace(o.kind::text, '_', '-'))),
              'scene', jsonb_build_array(o."introducedSceneId", o."resolvedSceneId"),
              'status', jsonb_build_array(lower(replace(o.status::text, '_', '-')))
            ), lower(replace(o.status::text, '_', '-')), NULL,
            jsonb_build_object('type','open-loop','id',o.id,'key',o.key,'label',o.title), NULL::jsonb
          FROM "OpenLoop" o WHERE o."projectId" = ${projectId} AND o."buildRunId" = ${buildRunId} AND o."isCurrent"=true AND o."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'setup-payoff', sp.id, sp.key, sp.title, concat_ws(' ', sp.title, sp.description, sp.metadata::text),
            'setup-payoff', jsonb_build_object(
              'type', jsonb_build_array('setup-payoff'), 'setup', jsonb_build_array(sp.id, sp.key, sp.title, CASE WHEN sp.status IN ('PLANNED','SETUP','REINFORCED') AND sp."payoffSceneId" IS NULL AND sp."payoffArtifactId" IS NULL THEN 'unpaid' ELSE 'paid' END),
              'thread', jsonb_build_array(sp."plotThreadId"), 'scene', to_jsonb(sp."reinforcementSceneIds") || jsonb_build_array(sp."setupSceneId", sp."payoffSceneId"),
              'status', jsonb_build_array(lower(replace(sp.status::text, '_', '-')))
            ), lower(replace(sp.status::text, '_', '-')), NULL,
            jsonb_build_object('type','setup-payoff','id',sp.id,'key',sp.key,'label',sp.title), NULL::jsonb
          FROM "SetupPayoffLink" sp WHERE sp."projectId" = ${projectId} AND sp."buildRunId" = ${buildRunId} AND sp."isCurrent"=true AND sp."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'plot-thread', p.id, p.key, p.title, concat_ws(' ', p.title, p.summary, p.stakes, p.metadata::text),
            'thread', jsonb_build_object(
              'type', jsonb_build_array('plot-thread'), 'thread', jsonb_build_array(p.id, p.key, p.title, lower(replace(p.kind::text, '_', '-'))),
              'scene', to_jsonb(p."sceneIds"), 'status', jsonb_build_array(lower(replace(p.status::text, '_', '-')))
            ), lower(replace(p.status::text, '_', '-')), NULL,
            jsonb_build_object('type','plot-thread','id',p.id,'key',p.key,'label',p.title), NULL::jsonb
          FROM "PlotThread" p WHERE p."projectId" = ${projectId} AND p."buildRunId" = ${buildRunId} AND p."isCurrent"=true AND p."invalidatedAt" IS NULL
          UNION ALL
          SELECT 'build-unit', u.id, u.key, u.title,
            concat_ws(' ', u.title, u.key, u.metadata::text, v.body),
            CASE WHEN u.kind='SCENE' THEN 'scene-prose' ELSE 'chapter-prose' END,
            jsonb_build_object(
              'type', jsonb_build_array('build-unit',lower(u.kind::text)),
              'chapter', jsonb_build_array(u."parentUnitId",u."containerKey",u."chapterNumber"::text),
              'scene', jsonb_build_array(CASE WHEN u.kind='SCENE' THEN u.id ELSE NULL END,u.key),
              'pov', jsonb_build_array(u."povCharacterId"), 'location', jsonb_build_array(u."locationId"),
              'scene.goal', jsonb_build_array(coalesce(u.metadata->>'goal','')),
              'status', jsonb_build_array(lower(u.status::text)), 'order', u."order"
            ), lower(u.status::text), NULL,
            jsonb_build_object('type','build-unit','id',u.id,'key',u.key,'label',u.title),
            jsonb_build_object('unitId',u.id,'branchId',b.id,'writingVersionId',v.id)
          FROM "BuildManuscriptUnit" u
          JOIN "WritingBranch" b ON b.id=u."branchId" AND b."buildRunId"=${buildRunId}
          LEFT JOIN "WritingVersion" v ON v.id=b."headVersionId"
          WHERE u."projectId"=${projectId} AND u."buildRunId"=${buildRunId} AND u."invalidatedAt" IS NULL AND u.status <> 'INVALIDATED'
          UNION ALL
          SELECT 'act', act.id, NULL, act.title, act.title,
            'structure', jsonb_build_object('type',jsonb_build_array('act'),'status',jsonb_build_array('active'),'order',act."order"),
            'active', NULL, jsonb_build_object('type','act','id',act.id,'label',act.title), NULL::jsonb
          FROM "Act" act WHERE act."projectId"=${projectId}
          UNION ALL
          SELECT 'story-structure', structure.id, NULL, project.title,
            concat_ws(' ',project.title,project.genre,project.perspective,project.pov,project.voice,project.tone,array_to_string(project.themes,' '),lv.body,ov.body,cv.body),
            'structure',jsonb_build_object('type',jsonb_build_array('story-structure'),'status',jsonb_build_array('active')),
            'active',NULL,jsonb_build_object('type','story-structure','id',structure.id,'label',project.title),NULL::jsonb
          FROM "StoryStructure" structure JOIN "Project" project ON project.id=structure."projectId"
          LEFT JOIN "Writing" lw ON lw.id=structure."loglineWritingId" LEFT JOIN "WritingBranch" lb ON lb.id=lw."defaultBranchId" LEFT JOIN "WritingVersion" lv ON lv.id=lb."headVersionId"
          LEFT JOIN "Writing" ow ON ow.id=structure."outlineWritingId" LEFT JOIN "WritingBranch" ob ON ob.id=ow."defaultBranchId" LEFT JOIN "WritingVersion" ov ON ov.id=ob."headVersionId"
          LEFT JOIN "Writing" cw ON cw.id=structure."climaxWritingId" LEFT JOIN "WritingBranch" cb ON cb.id=cw."defaultBranchId" LEFT JOIN "WritingVersion" cv ON cv.id=cb."headVersionId"
          WHERE structure."projectId"=${projectId}
          UNION ALL
          SELECT 'relationship', relationship.id, NULL, concat_ws(' ',source.name,relationship.type,target.name),
            concat_ws(' ',source.name,relationship.type,target.name,relationship.note),
            'relationship',jsonb_build_object('type',jsonb_build_array('relationship'),'entity',jsonb_build_array(source.id,source.name,target.id,target.name),'status',jsonb_build_array('active')),
            'active',NULL,jsonb_build_object('type','relationship','id',relationship.id,'label',relationship.type),NULL::jsonb
          FROM "CharacterRelationship" relationship JOIN "Character" source ON source.id=relationship."fromCharacterId" JOIN "Character" target ON target.id=relationship."toCharacterId"
          WHERE relationship."projectId"=${projectId}
          UNION ALL
          SELECT 'asset', asset.id, coalesce(asset.name,asset."s3Key"), coalesce(asset.name,asset."s3Key"),
            concat_ws(' ',asset.name,asset."s3Key",asset."mimeType",asset.checksum),
            'asset',jsonb_build_object('type',jsonb_build_array('asset',lower(asset.kind::text)),'status',jsonb_build_array('active')),
            'active',NULL,jsonb_build_object('type','asset','id',asset.id,'label',coalesce(asset.name,asset."s3Key")),NULL::jsonb
          FROM "Asset" asset WHERE asset."projectId"=${projectId}
          UNION ALL
          SELECT 'character', c.id, NULL, c.name, concat_ws(' ', c.name, array_to_string(c.aliases,' '), c.role, c.age, c.occupation, array_to_string(c.traits,' '), dv.body, av.body, mv.body, rv.body),
            'content', jsonb_build_object('type',jsonb_build_array('character'),'entity',to_jsonb(c.aliases) || jsonb_build_array(c.id,c.name),'status',jsonb_build_array('active')), 'active', NULL,
            jsonb_build_object('type','character','id',c.id,'label',c.name), NULL::jsonb
          FROM "Character" c
          LEFT JOIN "Writing" dw ON dw.id=c."descriptionWritingId" LEFT JOIN "WritingBranch" db ON db.id=dw."defaultBranchId" LEFT JOIN "WritingVersion" dv ON dv.id=db."headVersionId"
          LEFT JOIN "Writing" aw ON aw.id=c."appearanceWritingId" LEFT JOIN "WritingBranch" ab ON ab.id=aw."defaultBranchId" LEFT JOIN "WritingVersion" av ON av.id=ab."headVersionId"
          LEFT JOIN "Writing" mw ON mw.id=c."motivationWritingId" LEFT JOIN "WritingBranch" mb ON mb.id=mw."defaultBranchId" LEFT JOIN "WritingVersion" mv ON mv.id=mb."headVersionId"
          LEFT JOIN "Writing" rw ON rw.id=c."arcWritingId" LEFT JOIN "WritingBranch" rb ON rb.id=rw."defaultBranchId" LEFT JOIN "WritingVersion" rv ON rv.id=rb."headVersionId"
          WHERE c."projectId"=${projectId}
          UNION ALL
          SELECT 'location', l.id, NULL, l.name, concat_ws(' ', l.name, array_to_string(l.aliases,' '), l.type, dv.body, av.body, sv.body, xv.body),
            'content', jsonb_build_object('type',jsonb_build_array('location'),'location',jsonb_build_array(l.id,l.name) || to_jsonb(l.aliases),'status',jsonb_build_array('active')), 'active', NULL,
            jsonb_build_object('type','location','id',l.id,'label',l.name), NULL::jsonb
          FROM "Location" l
          LEFT JOIN "Writing" dw ON dw.id=l."descriptionWritingId" LEFT JOIN "WritingBranch" db ON db.id=dw."defaultBranchId" LEFT JOIN "WritingVersion" dv ON dv.id=db."headVersionId"
          LEFT JOIN "Writing" aw ON aw.id=l."atmosphereWritingId" LEFT JOIN "WritingBranch" ab ON ab.id=aw."defaultBranchId" LEFT JOIN "WritingVersion" av ON av.id=ab."headVersionId"
          LEFT JOIN "Writing" sw ON sw.id=l."significanceWritingId" LEFT JOIN "WritingBranch" sb ON sb.id=sw."defaultBranchId" LEFT JOIN "WritingVersion" sv ON sv.id=sb."headVersionId"
          LEFT JOIN "Writing" xw ON xw.id=l."sensoryWritingId" LEFT JOIN "WritingBranch" xb ON xb.id=xw."defaultBranchId" LEFT JOIN "WritingVersion" xv ON xv.id=xb."headVersionId"
          WHERE l."projectId"=${projectId}
          UNION ALL
          SELECT 'doc', d.id, NULL, d.title, concat_ws(' ', d.title, v.body),
            'content', jsonb_build_object('type',jsonb_build_array('doc'),'status',jsonb_build_array('active')), 'active', NULL,
            jsonb_build_object('type','doc','id',d.id,'label',d.title), NULL::jsonb
          FROM "ProjectDoc" d
          JOIN "Writing" w ON w.id=d."bodyWritingId" LEFT JOIN "WritingBranch" b ON b.id=w."defaultBranchId" LEFT JOIN "WritingVersion" v ON v.id=b."headVersionId"
          WHERE d."projectId"=${projectId}
          UNION ALL
          SELECT 'obstacle', o.id, NULL, o.title, concat_ws(' ', o.title, dv.body, rv.body),
            'content', jsonb_build_object('type',jsonb_build_array('obstacle'),'status',jsonb_build_array('active')), 'active', NULL,
            jsonb_build_object('type','obstacle','id',o.id,'label',o.title), NULL::jsonb
          FROM "Obstacle" o
          LEFT JOIN "Writing" dw ON dw.id=o."descriptionWritingId" LEFT JOIN "WritingBranch" db ON db.id=dw."defaultBranchId" LEFT JOIN "WritingVersion" dv ON dv.id=db."headVersionId"
          LEFT JOIN "Writing" rw ON rw.id=o."resolutionWritingId" LEFT JOIN "WritingBranch" rb ON rb.id=rw."defaultBranchId" LEFT JOIN "WritingVersion" rv ON rv.id=rb."headVersionId"
          WHERE o."projectId"=${projectId}
        ), indexed AS (
          SELECT *, to_tsvector('english', coalesce(search_text,'')) document FROM corpus
        ), matched AS (
          SELECT *, ${score} score_value FROM indexed
          WHERE ${match} ${kindFilter} ${fieldFilter} ${statusFilter} ${artifactFilter} ${structuredFilter}
        )
        SELECT kind, id, key, title,
          CASE
            WHEN ${input.query} <> '' AND ${sourceMatchPosition} > 0
              THEN substring(regexp_replace(source.source_body, '<[^>]+>', '', 'g') FROM greatest(1, ${sourceMatchPosition} - 120) FOR 500)
            ELSE left(regexp_replace(source.source_body, '<[^>]+>', '', 'g'), 500)
          END snippet,
          score_value AS score, ref, source_span,
          CASE WHEN ${sourceMatchPosition} > 0 THEN ${sourceMatchPosition} - 1 ELSE NULL END absolute_start,
          CASE WHEN ${sourceMatchPosition} > 0 THEN 1 + length(left(source.source_body, ${sourceMatchPosition} - 1)) - length(replace(left(source.source_body, ${sourceMatchPosition} - 1), E'\n', '')) ELSE NULL END line_start,
          count(*) OVER() AS total
        FROM matched
        LEFT JOIN LATERAL (SELECT coalesce(CASE
          WHEN kind='build-unit' THEN (SELECT version.body FROM "BuildManuscriptUnit" unit JOIN "WritingBranch" branch ON branch.id=unit."branchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE unit.id=matched.id)
          WHEN kind='chapter' THEN (SELECT version.body FROM "Chapter" chapter JOIN "Writing" writing ON writing.id=chapter."bodyWritingId" LEFT JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE chapter.id=matched.id)
          WHEN kind='scene' THEN (SELECT version.body FROM "Scene" scene JOIN "Writing" writing ON writing.id=scene."bodyWritingId" LEFT JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE scene.id=matched.id)
          ELSE search_text END, '') source_body) source ON true
        ORDER BY score_value DESC, kind ASC, title ASC, id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
    });
    return {
      hits: rows.map((row) => ({
        kind: row.kind as StorySearchHit['kind'],
        id: row.id,
        key: row.key,
        title: row.title,
        snippet: row.snippet,
        score: Number(row.score),
        ref: row.ref as unknown as StorySearchHit['ref'],
        sourceSpan: searchSourceSpan(row.source_span, row.snippet, input.query, row.absolute_start, row.line_start)
      })),
      total: rows[0] ? Number(rows[0].total) : 0
    };
  }

  async findReferences(
    projectId: string,
    buildRunId: string,
    input: Required<Pick<FindStoryReferencesInput, 'refType' | 'refId' | 'limit' | 'offset'>>
  ): Promise<{ hits: StoryReferenceHit[]; total: number }> {
    const terms = await this.referenceTerms(projectId, buildRunId, input.refType, input.refId);
    if (!terms.length) throw new HttpError(404, `Reference target '${input.refType}:${input.refId}' was not found`);
    const proseMatch = Prisma.join(terms.map((term) => Prisma.sql`position(lower(${term}) in lower(coalesce(v.body,''))) > 0`), ' OR ');
    const firstProseMatch = Prisma.sql`least(${Prisma.join(terms.map((term) => Prisma.sql`nullif(position(lower(${term}) in lower(coalesce(v.body,''))), 0)`))})`;
    const proseSnippet = Prisma.sql`substring(coalesce(v.body,'') FROM greatest(1, ${firstProseMatch} - 120) FOR 500)`;
    const absoluteReferenceMatch = Prisma.sql`least(${Prisma.join(terms.map((term) => Prisma.sql`nullif(position(lower(${term}) in lower(source.source_body)), 0)`))})`;
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
      return tx.$queryRaw<RawReferenceRow[]>(Prisma.sql`
        WITH refs AS (
          SELECT 'artifact'::text kind, a.id, a.key, a.title,
            left(a.content::text,500) snippet, jsonb_build_object('type','artifact','id',a.id,'key',a.key,'label',a.title) ref,
            jsonb_build_object('artifactId',a.id) source_span, 'content'::text path, 'structured-reference'::text relationship
          FROM "StoryArtifact" a
          WHERE a."projectId"=${projectId} AND a."buildRunId"=${buildRunId}
            AND a.status IN ('DRAFT','VALIDATED','ACCEPTED') AND a."invalidatedAt" IS NULL
            AND jsonb_path_exists(a.content, '$.** ? (@.id == $id || @.key == $id)', jsonb_build_object('id', to_jsonb(${input.refId}::text)))
          UNION ALL
          SELECT 'canon-fact', f.id, f.key, concat_ws(' ',f."subjectId",f.predicate), left(f.object::text,500),
            jsonb_build_object('type','canon-fact','id',f.id,'key',f.key), f."sourceSpan", 'subject/object',
            CASE WHEN f."subjectId"=${input.refId} THEN 'subject' ELSE 'object-reference' END
          FROM "CanonFact" f WHERE f."projectId"=${projectId} AND f."buildRunId"=${buildRunId}
            AND f."isCurrent"=true AND f."invalidatedAt" IS NULL
            AND (f."subjectId"=${input.refId} OR jsonb_path_exists(f.object, '$.** ? (@ == $id || @.id == $id)', jsonb_build_object('id',to_jsonb(${input.refId}::text))))
          UNION ALL
          SELECT 'entity-state', e.id, e.key, concat_ws(' ',e."entityId",e."stateKey"), left(e.value::text,500),
            jsonb_build_object('type','entity-state','id',e.id,'key',e.key), e."sourceSpan", 'entity/value',
            CASE WHEN e."entityId"=${input.refId} THEN 'entity' ELSE 'state-value-reference' END
          FROM "EntityState" e WHERE e."projectId"=${projectId} AND e."buildRunId"=${buildRunId}
            AND e."isCurrent"=true AND e."invalidatedAt" IS NULL
            AND (e."entityId"=${input.refId} OR jsonb_path_exists(e.value, '$.** ? (@ == $id || @.id == $id)', jsonb_build_object('id',to_jsonb(${input.refId}::text))))
          UNION ALL
          SELECT 'timeline-event', t.id, t.key, t.title, left(concat_ws(' ',t.description,t.chronology::text,t."participantRefs"::text),500),
            jsonb_build_object('type','timeline-event','id',t.id,'key',t.key,'label',t.title), t."sourceSpan", 'timeline', 'timeline-reference'
          FROM "TimelineEvent" t WHERE t."projectId"=${projectId} AND t."buildRunId"=${buildRunId}
            AND t."isCurrent"=true AND t."invalidatedAt" IS NULL
            AND (${input.refId}=t."sceneId" OR ${input.refId}=t."chapterId" OR ${input.refId}=ANY(t."dependencyIds")
              OR jsonb_path_exists(t."participantRefs", '$.** ? (@.id == $id)', jsonb_build_object('id',to_jsonb(${input.refId}::text))))
          UNION ALL
          SELECT 'scene', s.id, NULL, coalesce(s.title,'Untitled scene'), left(concat_ws(' ',s.summary,s."writerNotes",s."aiNotes"),500),
            jsonb_build_object('type','scene','id',s.id,'label',coalesce(s.title,'Untitled scene')), jsonb_build_object('chapterId',s."chapterId",'sceneId',s.id), 'metadata', 'scene-reference'
          FROM "Scene" s JOIN "Chapter" c ON c.id=s."chapterId"
          WHERE c."projectId"=${projectId} AND (${input.refId}=s."povCharacterId" OR ${input.refId}=s."locationId"
            OR ${input.refId}=ANY(s."characterPresentIds") OR ${input.refId}=ANY(s."characterReferencedIds")
            OR ${input.refId}=ANY(s."plotThreadIds") OR ${input.refId}=ANY(s."setupPayoffIds"))
          UNION ALL
          SELECT 'open-loop', o.id, o.key, o.title, left(concat_ws(' ',o.description,o."targetPayoff"),500),
            jsonb_build_object('type','open-loop','id',o.id,'key',o.key,'label',o.title), NULL::jsonb, 'resolution', 'open-loop-reference'
          FROM "OpenLoop" o WHERE o."projectId"=${projectId} AND o."buildRunId"=${buildRunId}
            AND o."isCurrent"=true AND o."invalidatedAt" IS NULL
            AND ${input.refId} IN (coalesce(o."introducedSceneId",''),coalesce(o."resolvedSceneId",''),coalesce(o."introducedArtifactId",''),coalesce(o."resolvedArtifactId",''))
          UNION ALL
          SELECT 'setup-payoff', sp.id, sp.key, sp.title, left(concat_ws(' ',sp.description,sp.metadata::text),500),
            jsonb_build_object('type','setup-payoff','id',sp.id,'key',sp.key,'label',sp.title), NULL::jsonb, 'setup-payoff', 'setup-payoff-reference'
          FROM "SetupPayoffLink" sp WHERE sp."projectId"=${projectId} AND sp."buildRunId"=${buildRunId}
            AND sp."isCurrent"=true AND sp."invalidatedAt" IS NULL
            AND (${input.refId}=sp."plotThreadId" OR ${input.refId}=sp."setupSceneId" OR ${input.refId}=sp."payoffSceneId"
              OR ${input.refId}=sp."setupArtifactId" OR ${input.refId}=sp."payoffArtifactId" OR ${input.refId}=ANY(sp."reinforcementSceneIds"))
          UNION ALL
          SELECT 'plot-thread', p.id, p.key, p.title, left(concat_ws(' ',p.summary,p.stakes),500),
            jsonb_build_object('type','plot-thread','id',p.id,'key',p.key,'label',p.title), NULL::jsonb, 'thread', 'plot-thread-reference'
          FROM "PlotThread" p WHERE p."projectId"=${projectId} AND p."buildRunId"=${buildRunId}
            AND p."isCurrent"=true AND p."invalidatedAt" IS NULL
            AND (${input.refId}=p."sourceArtifactId" OR ${input.refId}=p."parentThreadId" OR ${input.refId}=ANY(p."sceneIds"))
          UNION ALL
          SELECT 'artifact', l.id, NULL, l."relationType", l."relationType", jsonb_build_object('type','artifact-link','id',l.id), NULL::jsonb,
            'artifact-link', CASE WHEN l."fromArtifactId"=${input.refId} THEN 'outgoing' ELSE 'incoming' END
          FROM "StoryArtifactLink" l WHERE l."projectId"=${projectId} AND l."buildRunId"=${buildRunId}
            AND (${input.refId}=l."fromArtifactId" OR ${input.refId}=l."toArtifactId")
          UNION ALL
          SELECT 'character', r.id, NULL, r.type, left(coalesce(r.note,''),500),
            jsonb_build_object('type','character-relationship','id',r.id,'label',r.type), NULL::jsonb,
            'relationship', CASE WHEN r."fromCharacterId"=${input.refId} THEN 'outgoing-relationship' ELSE 'incoming-relationship' END
          FROM "CharacterRelationship" r WHERE r."projectId"=${projectId}
            AND (${input.refId}=r."fromCharacterId" OR ${input.refId}=r."toCharacterId")
          UNION ALL
          SELECT 'build-unit', u.id, u.key, u.title, ${proseSnippet},
            jsonb_build_object('type','build-unit','id',u.id,'key',u.key,'label',u.title),
            jsonb_build_object('unitId',u.id), 'prose', 'prose-mention'
          FROM "BuildManuscriptUnit" u JOIN "WritingBranch" b ON b.id=u."branchId" AND b."buildRunId"=${buildRunId}
          JOIN "WritingVersion" v ON v.id=b."headVersionId"
          WHERE u."projectId"=${projectId} AND u."buildRunId"=${buildRunId} AND u."invalidatedAt" IS NULL AND u.status <> 'INVALIDATED'
            AND (${proseMatch})
          UNION ALL
          SELECT 'chapter', chapter.id, NULL, chapter.title, ${proseSnippet},
            jsonb_build_object('type','chapter','id',chapter.id,'label',chapter.title), jsonb_build_object('chapterId',chapter.id),
            'prose','main-prose-mention'
          FROM "Chapter" chapter JOIN "Writing" writing ON writing.id=chapter."bodyWritingId"
          JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" JOIN "WritingVersion" v ON v.id=branch."headVersionId"
          WHERE chapter."projectId"=${projectId} AND chapter."deletedAt" IS NULL AND (${proseMatch})
          UNION ALL
          SELECT 'scene', scene.id, NULL, coalesce(scene.title,'Untitled scene'), ${proseSnippet},
            jsonb_build_object('type','scene','id',scene.id,'label',coalesce(scene.title,'Untitled scene')),
            jsonb_build_object('chapterId',scene."chapterId",'sceneId',scene.id),'prose','main-prose-mention'
          FROM "Scene" scene JOIN "Chapter" chapter ON chapter.id=scene."chapterId"
          JOIN "Writing" writing ON writing.id=scene."bodyWritingId"
          JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" JOIN "WritingVersion" v ON v.id=branch."headVersionId"
          WHERE chapter."projectId"=${projectId} AND chapter."deletedAt" IS NULL AND (${proseMatch})
        )
        SELECT refs.*,
          count(*) OVER() AS total,
          CASE WHEN refs.path='prose' AND ${absoluteReferenceMatch} > 0 THEN ${absoluteReferenceMatch} - 1 ELSE NULL END absolute_start,
          CASE WHEN refs.path='prose' AND ${absoluteReferenceMatch} > 0
            THEN 1 + length(left(source.source_body, ${absoluteReferenceMatch} - 1)) - length(replace(left(source.source_body, ${absoluteReferenceMatch} - 1), E'\n', ''))
            ELSE NULL END line_start
        FROM refs
        LEFT JOIN LATERAL (SELECT coalesce(CASE
          WHEN refs.kind='build-unit' THEN (SELECT version.body FROM "BuildManuscriptUnit" unit JOIN "WritingBranch" branch ON branch.id=unit."branchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE unit.id=refs.id)
          WHEN refs.kind='chapter' THEN (SELECT version.body FROM "Chapter" chapter JOIN "Writing" writing ON writing.id=chapter."bodyWritingId" LEFT JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE chapter.id=refs.id)
          WHEN refs.kind='scene' THEN (SELECT version.body FROM "Scene" scene JOIN "Writing" writing ON writing.id=scene."bodyWritingId" LEFT JOIN "WritingBranch" branch ON branch.id=writing."defaultBranchId" LEFT JOIN "WritingVersion" version ON version.id=branch."headVersionId" WHERE scene.id=refs.id)
          ELSE '' END, '') source_body) source ON true
        ORDER BY kind,title,id LIMIT ${input.limit} OFFSET ${input.offset}
      `);
    });
    return {
      hits: rows.map((row) => ({
        kind: row.kind as StoryReferenceHit['kind'], id: row.id, key: row.key, title: row.title,
        snippet: row.snippet, score: 1, ref: row.ref as unknown as StoryReferenceHit['ref'],
        sourceSpan: referenceSourceSpan(row.source_span, row.snippet, terms, row.absolute_start, row.line_start), path: row.path, relationship: row.relationship
      })),
      total: rows[0] ? Number(rows[0].total) : 0
    };
  }

  private async referenceTerms(projectId: string, buildRunId: string, refType: string, refId: string): Promise<string[]> {
    if (refType === 'character') {
      const [character, bible, fact, state] = await Promise.all([
        this.prisma.character.findFirst({ where: { projectId, OR: [{ id: refId }, { name: refId }, { aliases: { has: refId } }] }, select: { id: true, name: true, aliases: true } }),
        this.prisma.storyArtifact.findFirst({ where: { projectId, buildRunId, type: 'CHARACTER_BIBLE', invalidatedAt: null, OR: [{ id: refId }, { key: refId }, { content: { path: ['characterKey'], equals: refId } }] }, select: { id: true, key: true, title: true, content: true } }),
        this.prisma.canonFact.findFirst({ where: { projectId, buildRunId, subjectType: 'character', subjectId: refId, isCurrent: true, invalidatedAt: null }, select: { subjectId: true } }),
        this.prisma.entityState.findFirst({ where: { projectId, buildRunId, entityType: 'character', entityId: refId, isCurrent: true, invalidatedAt: null }, select: { entityId: true } })
      ]);
      const content = bible?.content && typeof bible.content === 'object' && !Array.isArray(bible.content) ? bible.content as Prisma.JsonObject : null;
      const values: unknown[] = [refId, character?.id, character?.name, ...(character?.aliases ?? []), bible?.id, bible?.key, bible?.title, content?.characterKey, content?.name, ...(Array.isArray(content?.aliases) ? content.aliases : []), fact?.subjectId, state?.entityId];
      return character || bible || fact || state ? searchableTerms(values) : [];
    }
    const values = refType === 'location' ? await this.prisma.location.findFirst({ where: { projectId, OR: [{ id: refId }, { name: refId }, { aliases: { has: refId } }] }, select: { id: true, name: true, aliases: true } })
      : refType === 'chapter' ? await this.prisma.buildManuscriptUnit.findFirst({ where: { projectId, buildRunId, kind: 'CHAPTER', OR: [{ id: refId }, { key: refId }] }, select: { id: true, key: true, title: true } }) ?? await this.prisma.chapter.findFirst({ where: { projectId, OR: [{ id: refId }, { title: refId }] }, select: { id: true, title: true } })
      : refType === 'scene' ? await this.prisma.buildManuscriptUnit.findFirst({ where: { projectId, buildRunId, kind: 'SCENE', OR: [{ id: refId }, { key: refId }] }, select: { id: true, key: true, title: true } }) ?? await this.prisma.scene.findFirst({ where: { chapter: { projectId }, OR: [{ id: refId }, { title: refId }] }, select: { id: true, title: true } })
      : refType === 'build-unit' ? await this.prisma.buildManuscriptUnit.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }] }, select: { id: true, key: true, title: true } })
      : refType === 'artifact' ? await this.prisma.storyArtifact.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }] }, select: { id: true, key: true, title: true } })
      : refType === 'canon-fact' ? await this.prisma.canonFact.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, subjectId: true, predicate: true } })
      : refType === 'entity-state' ? await this.prisma.entityState.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, entityId: true, stateKey: true } })
      : refType === 'timeline-event' ? await this.prisma.timelineEvent.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, title: true } })
      : refType === 'open-loop' ? await this.prisma.openLoop.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, title: true } })
      : refType === 'setup-payoff' ? await this.prisma.setupPayoffLink.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, title: true } })
      : refType === 'plot-thread' ? await this.prisma.plotThread.findFirst({ where: { projectId, buildRunId, OR: [{ id: refId }, { key: refId }], isCurrent: true }, select: { id: true, key: true, title: true } })
      : null;
    return values ? searchableTerms(Object.values(values)) : [];
  }
}

function searchableTerms(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string' && value.trim().length > 1))].slice(0, 50);
}

function searchSourceSpan(raw: Prisma.JsonValue | null, snippet: string, query: string, absoluteStart: number | null, lineStart: number | null): StorySearchHit['sourceSpan'] {
  const span = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const needle = query.trim();
  const start = needle ? snippet.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (absoluteStart !== null) return {
    ...span,
    start: absoluteStart,
    end: absoluteStart + needle.length,
    ...(lineStart === null ? {} : { lineStart, lineEnd: lineStart + (needle.match(/\n/g)?.length ?? 0) }),
    quote: start >= 0 ? snippet.slice(start, start + needle.length) : needle
  } as StorySearchHit['sourceSpan'];
  return Object.keys(span).length ? span as StorySearchHit['sourceSpan'] : null;
}

function referenceSourceSpan(raw: Prisma.JsonValue | null, snippet: string, terms: string[], absoluteStart: number | null, lineStart: number | null): StoryReferenceHit['sourceSpan'] {
  const span = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const matches = terms.map((term) => ({ term, start: snippet.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) })).filter((match) => match.start >= 0).sort((left, right) => left.start - right.start);
  const match = matches[0];
  if (match && absoluteStart !== null) return {
    ...span,
    start: absoluteStart,
    end: absoluteStart + match.term.length,
    ...(lineStart === null ? {} : { lineStart, lineEnd: lineStart + (match.term.match(/\n/g)?.length ?? 0) }),
    quote: snippet.slice(match.start, match.start + match.term.length)
  } as StoryReferenceHit['sourceSpan'];
  if (match) return { ...span, start: match.start, end: match.start + match.term.length, quote: snippet.slice(match.start, match.start + match.term.length) } as StoryReferenceHit['sourceSpan'];
  return Object.keys(span).length ? span as StoryReferenceHit['sourceSpan'] : null;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) throw new HttpError(400, 'Pagination values must be integers');
  return Math.min(Math.max(value, min), max);
}

function latestEntityStates<T extends { entityType: string; entityId: string; stateKey: string; validFromOrder: number | null; storyOrder: number | null; version: number }>(states: T[]): T[] {
  const latest = new Map<string, T>();
  for (const state of states) {
    const key = `${state.entityType}:${state.entityId}:${state.stateKey}`;
    const current = latest.get(key);
    const order = state.validFromOrder ?? state.storyOrder ?? -1;
    const currentOrder = current ? current.validFromOrder ?? current.storyOrder ?? -1 : -Infinity;
    if (!current || order > currentOrder || (order === currentOrder && state.version > current.version)) latest.set(key, state);
  }
  return [...latest.values()];
}
