export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export interface ImageSample { id: string; name: string; dataUrl: string; size: number; fingerprint: string; createdAt: string }
export interface ImageClass { id: string; name: string; color: string; samples: ImageSample[] }
export interface TrainingParams { imageSize: number; batchSize: number; epochs: number; optimizer: 'AdamW' | 'SGD'; learningRate: number }
export interface EpochMetric { epoch: number; trainLoss: number; valLoss: number; accuracy: number }
export interface TrainingRun { id: string; projectId: string; revision: number; status: RunStatus; params: TrainingParams; metrics: EpochMetric[]; startedAt: string; finishedAt?: string; message: string; sampleCount: number; isMock: true }
export interface Project { id: string; name: string; createdAt: string; updatedAt: string; revision: number; classes: ImageClass[]; params: TrainingParams; runs: TrainingRun[] }
export interface WorkspaceState { ready: boolean; projects: Project[]; activeProjectId: string | null; saveStatus: 'saved' | 'saving' | 'error'; error: string | null; notice: string | null }
export interface Prediction { isMock: true; runId: string; scores: { classId: string; name: string; score: number; color: string }[] }
export const CLASS_COLORS = ['#5d8bf4','#eba34f','#8c79d8','#42ad98','#d478a2','#51a5cc','#a49a54','#a67a69'];
export const DEFAULT_PARAMS: TrainingParams = { imageSize: 224, batchSize: 16, epochs: 30, optimizer: 'AdamW', learningRate: 0.001 };
