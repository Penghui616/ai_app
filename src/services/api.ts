import type { ClassificationApi } from './contracts';
import { mockApi } from './mockApi';
import { httpApi } from './httpApi';
export const isRealTraining=import.meta.env.VITE_API_MODE!=='mock';
export const api:ClassificationApi=isRealTraining?httpApi:mockApi;
