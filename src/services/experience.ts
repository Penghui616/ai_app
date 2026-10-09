import { openDB } from 'idb';
import type { ImageSample } from '../types';
export interface Score { id?: number; name?: string; label: string; score: number }
export interface ExperienceRecord {
  id: string; createdAt: string; modelId: string; modelVersion?: string; isMock: boolean;
  image: ImageSample; scores: Score[]; note: string; latencyMs?: number; uncertain?: boolean;
}
export interface ExperienceModel {
  id: string; name: string; version: string; repository: string; status: 'loading'|'ready'|'error';
  error: string|null; classCount: number; labels: {id:number;name:string;label:string}[];
}
const db = () => openDB('vision-lab-experience-v1', 1, { upgrade(database) { database.createObjectStore('records'); } });
const validScores = (scores: unknown): scores is Score[] => Array.isArray(scores) && scores.length > 0 && scores.length <= 36 && scores.every(item => item && typeof item.label === 'string' && typeof item.score === 'number' && Number.isFinite(item.score) && item.score >= 0 && item.score <= 1);
export async function loadExperiences(): Promise<ExperienceRecord[]> {
  const database = await db();
  const stored: unknown = await database.get('records', 'recent');
  if (stored === undefined) return [];
  if (!Array.isArray(stored) || !stored.every(record => record && typeof record.id === 'string' && typeof record.createdAt === 'string' && typeof record.isMock === 'boolean' &&
    (record.isMock ? record.modelId==='fruit-ui-demo-v1' : record.modelId==='fruit-veg-36' && typeof record.modelVersion==='string') &&
    typeof record.note==='string' && record.image && typeof record.image.name==='string' && typeof record.image.dataUrl==='string' && validScores(record.scores))) throw new Error('Invalid experience records');
  return stored.slice(0,12) as ExperienceRecord[];
}
export async function saveExperiences(records: ExperienceRecord[]): Promise<void> {
  const database = await db(); await database.put('records', records.slice(0, 12), 'recent');
}
async function apiRequest(path:string, init:RequestInit = {}):Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort',abort,{once:true});
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort,20000);
  try {
    let response:Response;
    for(let attempt=0;;attempt++) {
      response=await fetch(path,{...init,signal:controller.signal});
      if(response.status!==429||attempt>=2)break;
      await response.body?.cancel();
      await new Promise<void>((resolve,reject)=>{
        const stopped=()=>{clearTimeout(wait);reject(new DOMException('Cancelled','AbortError'));};
        const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',stopped);resolve();},500);
        if(controller.signal.aborted)stopped();else controller.signal.addEventListener('abort',stopped,{once:true});
      });
    }
    if (!response.ok) {
      const payload = await response.json().catch(()=>null);
      throw new Error(typeof payload?.detail === 'string' ? payload.detail : `识别服务暂不可用（${response.status}），请检查后端后重试。`);
    }
    return await response.json();
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException('Cancelled','AbortError');
    if (controller.signal.aborted) throw new Error('识别请求超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接识别服务，请启动后端后重试。');
    throw error;
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort',abort); }
}
export async function getExperienceModel(signal?:AbortSignal):Promise<ExperienceModel> {
  const result = await apiRequest('/api/v1/experience/models',{signal});
  const model = result.models?.find((item:ExperienceModel)=>item.id==='fruit-veg-36');
  if (!model || !Array.isArray(model.labels) || model.labels.length!==36 || !['ready','loading','error'].includes(model.status)) throw new Error('模型信息异常，请检查后端版本。');
  return model;
}
async function imageBlob(image:ImageSample):Promise<Blob> {
  if (!image.dataUrl.startsWith('data:image/')) throw new Error('图片格式无效。');
  const blob = await (await fetch(image.dataUrl)).blob();
  if (blob.type.split(';')[0]!=='image/svg+xml') return blob;
  // Rasterize the bundled illustration; the server only accepts raster formats.
  const source = new Image(); source.src=image.dataUrl; await source.decode();
  const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=480;
  const context=canvas.getContext('2d');if(!context)throw new Error('无法读取示例图片。');
  context.drawImage(source,0,0,640,480);
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图片转换失败。')),'image/jpeg',.9));
}
export async function classifyImage(image:ImageSample,signal?:AbortSignal):Promise<ExperienceRecord> {
  const blob=await imageBlob(image);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const result=await apiRequest('/api/v1/experience/models/fruit-veg-36/predict',{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal});
  if(result.isMock!==false || result.modelId!=='fruit-veg-36' || typeof result.modelVersion!=='string' || !validScores(result.scores)) throw new Error('识别结果格式异常，未显示结果。');
  return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),modelId:result.modelId,modelVersion:result.modelVersion,isMock:false,
    scores:result.scores,image,note:'',latencyMs:result.latencyMs,uncertain:result.uncertain};
}
export function exampleImage(): ImageSample {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#f2f7f5"/><ellipse cx="320" cy="388" rx="124" ry="20" fill="#dce7dd"/><path d="M318 169c-74-54-159 4-141 102 13 72 60 115 99 105 25-7 35-7 60 0 48 15 99-36 108-109 12-100-60-145-126-98" fill="#dc6e5c"/><path d="M318 177c-2-31 1-57 13-80" fill="none" stroke="#805d42" stroke-width="13" stroke-linecap="round"/><path d="M330 138c15-43 54-48 85-35-11 35-43 52-85 35" fill="#74a789"/><path d="M222 207c-15 16-20 37-17 56" fill="none" stroke="#f7b4a1" stroke-width="13" stroke-linecap="round"/><text x="320" y="440" text-anchor="middle" fill="#789487" font-family="sans-serif" font-size="16">SAMPLE ILLUSTRATION</text></svg>`;
  return { id: crypto.randomUUID(), name: '苹果示例插画.svg', dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), size: svg.length, fingerprint: 'fruit-example-v1', createdAt: new Date().toISOString() };
}
