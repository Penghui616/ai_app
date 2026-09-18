import type { Project, TrainingParams, TrainingRun, Prediction, WorkspaceState } from '../types';
/** UI depends only on this boundary. Replace the mock implementation with FastAPI calls later. */
export interface ClassificationApi {
  initialize(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceState;
  createProject(name: string): Promise<Project>;
  selectProject(id: string): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  addClass(projectId: string): Promise<void>;
  renameClass(projectId: string, classId: string, name: string): Promise<void>;
  deleteClass(projectId: string, classId: string): Promise<void>;
  addImages(projectId: string, classId: string, files: File[]): Promise<number>;
  deleteImage(projectId: string, classId: string, imageId: string): Promise<void>;
  updateParams(projectId: string, values: Partial<TrainingParams>): Promise<void>;
  startTraining(projectId: string): Promise<TrainingRun>;
  cancelTraining(projectId: string): Promise<void>;
  predict(projectId: string, dataUrl: string): Promise<Prediction>;
  exportRecord(projectId: string): string;
  dismissNotice(): void;
}
