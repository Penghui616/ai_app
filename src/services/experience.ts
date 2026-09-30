import { openDB } from 'idb';
import type { ImageSample } from '../types';
export interface ExperienceRecord {
  id: string; createdAt: string; modelId: 'fruit-ui-demo-v1'; isMock: true;
  image: ImageSample; scores: { label: string; score: number }[]; note: string;
}
const db = () => openDB('vision-lab-experience-v1', 1, { upgrade(database) { database.createObjectStore('records'); } });
export async function loadExperiences(): Promise<ExperienceRecord[]> {
  const database = await db();
  const stored: unknown = await database.get('records', 'recent');
  if (stored === undefined) return [];
  if (!Array.isArray(stored) || !stored.every(record => record && typeof record.id === 'string' && typeof record.createdAt === 'string' && record.isMock === true && record.modelId === 'fruit-ui-demo-v1' && typeof record.note === 'string' && record.image && typeof record.image.name === 'string' && typeof record.image.dataUrl === 'string' && Array.isArray(record.scores) && record.scores.length === 3 && record.scores.every((item: { label?: unknown; score?: unknown }) => typeof item.label === 'string' && typeof item.score === 'number'))) throw new Error('Invalid experience records');
  return stored.slice(0,12) as ExperienceRecord[];
}
export async function saveExperiences(records: ExperienceRecord[]): Promise<void> {
  const database = await db(); await database.put('records', records.slice(0, 12), 'recent');
}
// Fixed presentation data, deliberately independent of image pixels or file name.
export function demonstrateClassification(image: ImageSample): ExperienceRecord {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), modelId: 'fruit-ui-demo-v1', isMock: true, image,
    scores: [{ label: '苹果', score: .62 }, { label: '香蕉', score: .24 }, { label: '橙子', score: .14 }], note: '' };
}
export function exampleImage(): ImageSample {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#f2f7f5"/><ellipse cx="320" cy="388" rx="124" ry="20" fill="#dce7dd"/><path d="M318 169c-74-54-159 4-141 102 13 72 60 115 99 105 25-7 35-7 60 0 48 15 99-36 108-109 12-100-60-145-126-98" fill="#dc6e5c"/><path d="M318 177c-2-31 1-57 13-80" fill="none" stroke="#805d42" stroke-width="13" stroke-linecap="round"/><path d="M330 138c15-43 54-48 85-35-11 35-43 52-85 35" fill="#74a789"/><path d="M222 207c-15 16-20 37-17 56" fill="none" stroke="#f7b4a1" stroke-width="13" stroke-linecap="round"/><text x="320" y="440" text-anchor="middle" fill="#789487" font-family="sans-serif" font-size="16">SAMPLE ILLUSTRATION</text></svg>`;
  return { id: crypto.randomUUID(), name: '苹果示例插画.svg', dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), size: svg.length, fingerprint: 'fruit-example-v1', createdAt: new Date().toISOString() };
}
