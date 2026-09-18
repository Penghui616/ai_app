import type { ClassificationApi } from './contracts';
import { mockApi } from './mockApi';
// Frontend prototype only. No backend requests or real model execution.
// Replace this single implementation with a typed FastAPI adapter when the backend is available.
export const api: ClassificationApi = mockApi;
