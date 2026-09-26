import type { Request, Response } from 'express';
import type {
  AnswerAiQuestionInput,
  CreateAiAgentSessionInput,
  CreateAiCharacterDialogueInput,
  CreateAiOutlineExpansionInput,
  CreateProjectAiSkillInput,
  CreateAiRewriteSuggestionInput,
  ReplyAiPermissionInput,
  SendAiAgentPromptInput,
  UpdateAiAgentSessionInput,
  UpdateProjectAiSkillInput,
  UpdateProjectAiSettingsInput
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { AiAssistUseCase } from '../useCases/ai/AiAssistUseCase.js';
import { OpencodeAgentUseCase } from '../useCases/ai/OpencodeAgentUseCase.js';
import { ProjectAiModelsUseCase } from '../useCases/ai/ProjectAiModelsUseCase.js';
import { ProjectAiSettingsUseCase } from '../useCases/ai/ProjectAiSettingsUseCase.js';
import { ProjectAiSkillsUseCase } from '../useCases/ai/ProjectAiSkillsUseCase.js';

export class AiController {
  private readonly settingsUseCase = new ProjectAiSettingsUseCase(prisma);
  private readonly assistUseCase = new AiAssistUseCase(prisma);
  private readonly agents = new OpencodeAgentUseCase(prisma);
  private readonly modelsUseCase = new ProjectAiModelsUseCase(prisma);
  private readonly skillsUseCase = new ProjectAiSkillsUseCase(prisma);

  getSettings = async (req: Request, res: Response) => {
    res.json(await this.settingsUseCase.get(this.userId(req), req.params.projectId));
  };

  updateSettings = async (req: Request, res: Response) => {
    res.json(
      await this.settingsUseCase.update(
        this.userId(req),
        req.params.projectId,
        req.body as UpdateProjectAiSettingsInput
      )
    );
  };

  models = async (req: Request, res: Response) => {
    res.json(await this.modelsUseCase.list(this.userId(req), req.params.projectId, req.query.source === 'catalog', req.query.refresh === 'true'));
  };

  discoverModels = async (req: Request, res: Response) => {
    res.json(await this.modelsUseCase.discover(this.userId(req), req.params.projectId, req.body));
  };

  continuityReview = async (req: Request, res: Response) => {
    const submissionId = typeof req.body?.submissionId === 'string' ? req.body.submissionId : '';
    if (!submissionId) throw new HttpError(400, 'submissionId is required');
    res.json(
      await this.assistUseCase.runContinuityReview(
        this.userId(req),
        req.params.projectId,
        submissionId
      )
    );
  };

  rewriteSuggestion = async (req: Request, res: Response) => {
    res.json(
      await this.assistUseCase.createRewriteSuggestion(
        this.userId(req),
        req.params.projectId,
        req.body as CreateAiRewriteSuggestionInput
      )
    );
  };

  characterDialogue = async (req: Request, res: Response) => {
    res.json(
      await this.assistUseCase.createCharacterDialogue(
        this.userId(req),
        req.params.projectId,
        req.body as CreateAiCharacterDialogueInput
      )
    );
  };

  outlineExpansion = async (req: Request, res: Response) => {
    res.json(
      await this.assistUseCase.createOutlineExpansion(
        this.userId(req),
        req.params.projectId,
        req.body as CreateAiOutlineExpansionInput
      )
    );
  };

  tools = async (req: Request, res: Response) => {
    res.json(await this.assistUseCase.listTools(this.userId(req), req.params.projectId));
  };

  skills = async (req: Request, res: Response) => {
    res.json(await this.skillsUseCase.list(this.userId(req), req.params.projectId));
  };

  createSkill = async (req: Request, res: Response) => {
    res.status(201).json(
      await this.skillsUseCase.create(
        this.userId(req),
        req.params.projectId,
        req.body as CreateProjectAiSkillInput
      )
    );
  };

  updateSkill = async (req: Request, res: Response) => {
    res.json(
      await this.skillsUseCase.update(
        this.userId(req),
        req.params.projectId,
        req.params.skillId,
        req.body as UpdateProjectAiSkillInput
      )
    );
  };

  deleteSkill = async (req: Request, res: Response) => {
    res.json(await this.skillsUseCase.delete(this.userId(req), req.params.projectId, req.params.skillId));
  };

  agentSessions = async (req: Request, res: Response) => {
    res.json(await this.agents.list(this.userId(req), req.params.projectId));
  };

  agentCapabilities = async (req: Request, res: Response) => {
    res.json(await this.agents.capabilities(this.userId(req), req.params.projectId));
  };

  agentEvents = async (req: Request, res: Response) => {
    await this.agents.stream(this.userId(req), req.params.projectId, res);
  };

  createAgentSession = async (req: Request, res: Response) => {
    res.status(201).json(
      await this.agents.create(this.userId(req), req.params.projectId, req.body as CreateAiAgentSessionInput)
    );
  };

  agentSession = async (req: Request, res: Response) => {
    res.json(await this.agents.get(this.userId(req), req.params.projectId, req.params.sessionId));
  };

  updateAgentSession = async (req: Request, res: Response) => {
    res.json(await this.agents.update(
      this.userId(req),
      req.params.projectId,
      req.params.sessionId,
      req.body as UpdateAiAgentSessionInput
    ));
  };

  deleteAgentSession = async (req: Request, res: Response) => {
    await this.agents.remove(this.userId(req), req.params.projectId, req.params.sessionId);
    res.status(204).end();
  };

  agentMessages = async (req: Request, res: Response) => {
    res.json(await this.agents.messages(this.userId(req), req.params.projectId, req.params.sessionId, {
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: optionalInteger(req.query.limit, 'limit')
    }));
  };

  sendAgentPrompt = async (req: Request, res: Response) => {
    res.json(await this.agents.prompt(
      this.userId(req),
      req.params.projectId,
      req.params.sessionId,
      req.body as SendAiAgentPromptInput
    ));
  };

  interruptAgentSession = async (req: Request, res: Response) => {
    res.json(await this.agents.interrupt(this.userId(req), req.params.projectId, req.params.sessionId));
  };

  replyPermission = async (req: Request, res: Response) => {
    await this.agents.replyPermission(
      this.userId(req),
      req.params.projectId,
      req.params.sessionId,
      req.params.requestId,
      req.body as ReplyAiPermissionInput
    );
    res.status(204).end();
  };

  answerQuestion = async (req: Request, res: Response) => {
    await this.agents.answerQuestion(
      this.userId(req),
      req.params.projectId,
      req.params.sessionId,
      req.params.questionId,
      req.body as AnswerAiQuestionInput
    );
    res.status(204).end();
  };

  dismissQuestion = async (req: Request, res: Response) => {
    await this.agents.dismissQuestion(this.userId(req), req.params.projectId, req.params.sessionId, req.params.questionId);
    res.status(204).end();
  };

  startGithubCopilotAuth = async (req: Request, res: Response) => {
    res.json(await this.settingsUseCase.startGithubCopilotAuth(this.userId(req), req.params.projectId));
  };

  pollGithubCopilotAuth = async (req: Request, res: Response) => {
    const deviceCode = typeof req.body?.deviceCode === 'string' ? req.body.deviceCode : '';
    res.json(
      await this.settingsUseCase.pollGithubCopilotAuth(
        this.userId(req),
        req.params.projectId,
        deviceCode
      )
    );
  };

  startCodexAuth = async (req: Request, res: Response) => {
    res.json(await this.settingsUseCase.startCodexAuth(this.userId(req), req.params.projectId));
  };

  pollCodexAuth = async (req: Request, res: Response) => {
    const deviceAuthId = typeof req.body?.deviceAuthId === 'string' ? req.body.deviceAuthId : '';
    const userCode = typeof req.body?.userCode === 'string' ? req.body.userCode : '';
    res.json(
      await this.settingsUseCase.pollCodexAuth(
        this.userId(req),
        req.params.projectId,
        deviceAuthId,
        userCode
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new HttpError(400, `${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, `${name} must be a safe integer`);
  return parsed;
}
