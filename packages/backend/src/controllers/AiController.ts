import type { Request, Response } from 'express';
import type {
  ApproveAiToolCallInput,
  ApproveAiToolCallsInput,
  CreateAiAgentSessionInput,
  CreateAiCharacterDialogueInput,
  CreateAiOutlineExpansionInput,
  CreateProjectAiSkillInput,
  CreateAiRewriteSuggestionInput,
  QueueAiAgentPromptInput,
  UpdateProjectAiSkillInput,
  UpdateProjectAiSettingsInput
} from '@opentales/sdk';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { AiAssistUseCase } from '../useCases/ai/AiAssistUseCase.js';
import { AiAgentSessionUseCase } from '../useCases/ai/AiAgentSessionUseCase.js';
import { ProjectAiSettingsUseCase } from '../useCases/ai/ProjectAiSettingsUseCase.js';
import { ProjectAiSkillsUseCase } from '../useCases/ai/ProjectAiSkillsUseCase.js';

export class AiController {
  private readonly settingsUseCase = new ProjectAiSettingsUseCase(prisma);
  private readonly assistUseCase = new AiAssistUseCase(prisma);
  private readonly agentSessionUseCase = new AiAgentSessionUseCase(prisma);
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

  agentSession = async (req: Request, res: Response) => {
    res.json(
      await this.agentSessionUseCase.get(
        this.userId(req),
        req.params.projectId,
        req.params.sessionId
      )
    );
  };

  agentSessions = async (req: Request, res: Response) => {
    res.json(await this.agentSessionUseCase.list(this.userId(req), req.params.projectId));
  };

  createAgentSession = async (req: Request, res: Response) => {
    res.status(201).json(
      await this.agentSessionUseCase.create(
        this.userId(req),
        req.params.projectId,
        req.body as CreateAiAgentSessionInput
      )
    );
  };

  agentSessionEvents = async (req: Request, res: Response) => {
    await this.agentSessionUseCase.subscribe(
      this.userId(req),
      req.params.projectId,
      res,
      req.params.sessionId
    );
  };

  queueAgentPrompt = async (req: Request, res: Response) => {
    res.json(
      await this.agentSessionUseCase.queuePrompt(
        this.userId(req),
        req.params.projectId,
        req.body as QueueAiAgentPromptInput,
        req.params.sessionId
      )
    );
  };

  cancelAgentSession = async (req: Request, res: Response) => {
    res.json(
      await this.agentSessionUseCase.cancel(
        this.userId(req),
        req.params.projectId,
        req.params.sessionId
      )
    );
  };

  approveToolCall = async (req: Request, res: Response) => {
    res.json(
      await this.agentSessionUseCase.approveToolCall(
        this.userId(req),
        req.params.projectId,
        req.params.toolCallId,
        req.body as ApproveAiToolCallInput,
        req.params.sessionId
      )
    );
  };

  approveToolCalls = async (req: Request, res: Response) => {
    res.json(
      await this.agentSessionUseCase.approveToolCalls(
        this.userId(req),
        req.params.projectId,
        req.body as ApproveAiToolCallsInput,
        req.params.sessionId
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    return req.user.id;
  }
}
