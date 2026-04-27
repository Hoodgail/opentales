import type { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../http/HttpError.js';
import { CreateActUseCase } from '../useCases/projects/CreateActUseCase.js';
import { CreateChapterUseCase } from '../useCases/projects/CreateChapterUseCase.js';
import { CreateCharacterUseCase } from '../useCases/projects/CreateCharacterUseCase.js';
import { CreateCharacterRelationshipUseCase } from '../useCases/projects/CreateCharacterRelationshipUseCase.js';
import { CreateLocationUseCase } from '../useCases/projects/CreateLocationUseCase.js';
import { CreateObstacleUseCase } from '../useCases/projects/CreateObstacleUseCase.js';
import { CreateProjectUseCase } from '../useCases/projects/CreateProjectUseCase.js';
import { DeleteActUseCase } from '../useCases/projects/DeleteActUseCase.js';
import { DeleteChapterUseCase } from '../useCases/projects/DeleteChapterUseCase.js';
import { DeleteCharacterUseCase } from '../useCases/projects/DeleteCharacterUseCase.js';
import { DeleteCharacterRelationshipUseCase } from '../useCases/projects/DeleteCharacterRelationshipUseCase.js';
import { DeleteLocationUseCase } from '../useCases/projects/DeleteLocationUseCase.js';
import { DeleteObstacleUseCase } from '../useCases/projects/DeleteObstacleUseCase.js';
import { GetProjectUseCase } from '../useCases/projects/GetProjectUseCase.js';
import { ListProjectsUseCase } from '../useCases/projects/ListProjectsUseCase.js';
import { UpdateActUseCase } from '../useCases/projects/UpdateActUseCase.js';
import { UpdateChapterUseCase } from '../useCases/projects/UpdateChapterUseCase.js';
import { UpdateCharacterUseCase } from '../useCases/projects/UpdateCharacterUseCase.js';
import { UpdateLocationUseCase } from '../useCases/projects/UpdateLocationUseCase.js';
import { UpdateObstacleUseCase } from '../useCases/projects/UpdateObstacleUseCase.js';
import { UpdateProjectUseCase } from '../useCases/projects/UpdateProjectUseCase.js';
import { UpdateStructureUseCase } from '../useCases/projects/UpdateStructureUseCase.js';

export class ProjectController {
  private readonly listProjectsUseCase = new ListProjectsUseCase(prisma);
  private readonly createProjectUseCase = new CreateProjectUseCase(prisma);
  private readonly getProjectUseCase = new GetProjectUseCase(prisma);
  private readonly updateProjectUseCase = new UpdateProjectUseCase(prisma);
  private readonly updateChapterUseCase = new UpdateChapterUseCase(prisma);
  private readonly updateCharacterUseCase = new UpdateCharacterUseCase(prisma);
  private readonly updateLocationUseCase = new UpdateLocationUseCase(prisma);
  private readonly updateStructureUseCase = new UpdateStructureUseCase(prisma);
  private readonly createActUseCase = new CreateActUseCase(prisma);
  private readonly updateActUseCase = new UpdateActUseCase(prisma);
  private readonly deleteActUseCase = new DeleteActUseCase(prisma);
  private readonly createCharacterUseCase = new CreateCharacterUseCase(prisma);
  private readonly deleteCharacterUseCase = new DeleteCharacterUseCase(prisma);
  private readonly createLocationUseCase = new CreateLocationUseCase(prisma);
  private readonly deleteLocationUseCase = new DeleteLocationUseCase(prisma);
  private readonly createChapterUseCase = new CreateChapterUseCase(prisma);
  private readonly deleteChapterUseCase = new DeleteChapterUseCase(prisma);
  private readonly createObstacleUseCase = new CreateObstacleUseCase(prisma);
  private readonly updateObstacleUseCase = new UpdateObstacleUseCase(prisma);
  private readonly deleteObstacleUseCase = new DeleteObstacleUseCase(prisma);
  private readonly createCharacterRelationshipUseCase = new CreateCharacterRelationshipUseCase(prisma);
  private readonly deleteCharacterRelationshipUseCase = new DeleteCharacterRelationshipUseCase(prisma);

  list = async (req: Request, res: Response) => {
    res.json(await this.listProjectsUseCase.execute(this.userId(req)));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.createProjectUseCase.execute(this.userId(req), req.body));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.getProjectUseCase.execute(this.userId(req), req.params.projectId));
  };

  update = async (req: Request, res: Response) => {
    res.json(await this.updateProjectUseCase.execute(this.userId(req), req.params.projectId, req.body));
  };

  updateChapter = async (req: Request, res: Response) => {
    res.json(
      await this.updateChapterUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId,
        req.body
      )
    );
  };

  updateCharacter = async (req: Request, res: Response) => {
    res.json(
      await this.updateCharacterUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.characterId,
        req.body
      )
    );
  };

  updateLocation = async (req: Request, res: Response) => {
    res.json(
      await this.updateLocationUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.locationId,
        req.body
      )
    );
  };

  updateStructure = async (req: Request, res: Response) => {
    res.json(await this.updateStructureUseCase.execute(this.userId(req), req.params.projectId, req.body));
  };

  createAct = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(await this.createActUseCase.execute(this.userId(req), req.params.projectId, req.body));
  };

  updateAct = async (req: Request, res: Response) => {
    res.json(
      await this.updateActUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.actId,
        req.body
      )
    );
  };

  deleteAct = async (req: Request, res: Response) => {
    res.json(
      await this.deleteActUseCase.execute(this.userId(req), req.params.projectId, req.params.actId)
    );
  };

  createCharacter = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.createCharacterUseCase.execute(this.userId(req), req.params.projectId, req.body)
      );
  };

  deleteCharacter = async (req: Request, res: Response) => {
    res.json(
      await this.deleteCharacterUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.characterId
      )
    );
  };

  createLocation = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.createLocationUseCase.execute(this.userId(req), req.params.projectId, req.body)
      );
  };

  deleteLocation = async (req: Request, res: Response) => {
    res.json(
      await this.deleteLocationUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.locationId
      )
    );
  };

  createChapter = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.createChapterUseCase.execute(this.userId(req), req.params.projectId, req.body)
      );
  };

  deleteChapter = async (req: Request, res: Response) => {
    res.json(
      await this.deleteChapterUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.chapterId
      )
    );
  };

  createObstacle = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.createObstacleUseCase.execute(this.userId(req), req.params.projectId, req.body)
      );
  };

  updateObstacle = async (req: Request, res: Response) => {
    res.json(
      await this.updateObstacleUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.obstacleId,
        req.body
      )
    );
  };

  deleteObstacle = async (req: Request, res: Response) => {
    res.json(
      await this.deleteObstacleUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.obstacleId
      )
    );
  };

  createCharacterRelationship = async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await this.createCharacterRelationshipUseCase.execute(
          this.userId(req),
          req.params.projectId,
          req.params.characterId,
          req.body
        )
      );
  };

  deleteCharacterRelationship = async (req: Request, res: Response) => {
    res.json(
      await this.deleteCharacterRelationshipUseCase.execute(
        this.userId(req),
        req.params.projectId,
        req.params.characterId,
        req.params.relationshipId
      )
    );
  };

  private userId(req: Request): string {
    if (!req.user) {
      throw new HttpError(401, 'Authentication required');
    }
    return req.user.id;
  }
}
