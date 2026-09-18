import { openDB } from 'idb';
import type { Project } from '../types';
export interface StoredWorkspace { version: 1; projects: Project[]; activeProjectId: string | null }
const database = () => openDB('vision-lab-frontend-v1', 1, { upgrade(db) { db.createObjectStore('workspace'); } });
export async function loadWorkspace(): Promise<StoredWorkspace | undefined> { const db = await database(); return db.get('workspace', 'current'); }
export async function saveWorkspace(data: StoredWorkspace): Promise<void> { const db = await database(); await db.put('workspace', data, 'current'); }
