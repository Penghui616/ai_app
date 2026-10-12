import type { ClassificationApi } from './contracts';
import type { Project, WorkspaceState, TrainingParams, TrainingRun, Prediction } from '../types';
import { prepareImage } from './images';
let state:WorkspaceState={ready:false,projects:[],activeProjectId:null,saveStatus:'saved',error:null,notice:null};
const listeners=new Set<()=>void>();
const activeKey='vision-lab:server-active-project';
let initialization:Promise<void>|null=null;
let queue:Promise<unknown>=Promise.resolve();
let generation=0;
let writing=false;
let pollTimer:ReturnType<typeof setTimeout>|undefined;
const message=(e:unknown)=>e instanceof Error?e.message:'服务器操作失败，请重试。';
const emit=(patch:Partial<WorkspaceState>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
 const controller=new AbortController();const abort=()=>controller.abort();
 init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)controller.abort();
 const timer=setTimeout(abort,30000);
 try{
  let response:Response;
  for(let attempt=0;;attempt++){
   response=await fetch('/api/v1'+path,{...init,credentials:'same-origin',signal:controller.signal});
   if(response.status!==429||attempt>=2)break;
   await response.body?.cancel();
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(typeof result?.detail==='string'?result.detail:`服务请求失败（${response.status}），请检查后端。`);
  return result as T;
 }catch(e){if(init.signal?.aborted)throw new DOMException('Cancelled','AbortError');if(controller.signal.aborted)throw new Error('请求超时，操作可能已提交，请刷新确认状态。');if(e instanceof TypeError)throw new Error('无法连接训练后端，请确认服务已启动。');throw e;}
 finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
function remember(id:string|null){try{if(id)localStorage.setItem(activeKey,id);else localStorage.removeItem(activeKey);}catch{/* Selection persistence is optional. */}}
function schedule(){
 clearTimeout(pollTimer);
 if(!state.projects.some(p=>p.runs.some(r=>r.status==='running')))return;
 pollTimer=setTimeout(async()=>{
  if(writing){schedule();return;}
  const token=generation;
  try{const projects=await request<Project[]>('/projects');if(token===generation)emit({projects,error:null});}
  catch(e){if(token===generation)emit({error:'训练状态更新失败：'+message(e)});}
  schedule();
 },1000);
}
async function refresh(){
 const projects=await request<Project[]>('/projects');
 const active=projects.some(p=>p.id===state.activeProjectId)?state.activeProjectId:projects[0]?.id??null;
 emit({projects,activeProjectId:active});remember(active);schedule();
}
function mutate<T>(operation:()=>Promise<T>):Promise<T>{
 const task=queue.catch(()=>{}).then(async()=>{
  generation++;writing=true;emit({saveStatus:'saving',error:null});
  try{const result=await operation();await refresh();emit({saveStatus:'saved'});return result;}
  catch(e){try{await refresh();}catch{/* Keep the last known data visible. */}emit({saveStatus:'error',error:message(e)});throw e;}
  finally{writing=false;generation++;schedule();}
 });queue=task;return task;
}
function project(id:string){const p=state.projects.find(p=>p.id===id);if(!p)throw new Error('项目不存在。');return p;}
export const httpApi:ClassificationApi={
 initialize(){
  if(initialization)return initialization;
  initialization=(async()=>{
   generation++;
   try{
    let projects=await request<Project[]>('/projects');
    if(!projects.length)projects=[await request<Project>('/projects',json('POST',{name:'我的第一个分类实验'}))];
    let selected:string|null=null;try{selected=localStorage.getItem(activeKey);}catch{/* optional */}
    const active=projects.some(p=>p.id===selected)?selected:projects[0]?.id??null;
    emit({ready:true,projects,activeProjectId:active,saveStatus:'saved',error:null,notice:'实验项目保存在后端。旧版浏览器演示数据未删除；当前训练使用服务器项目。'});
    remember(active);schedule();
   }catch(e){emit({ready:true,saveStatus:'error',error:message(e)});initialization=null;}
  })();return initialization;
 },
 subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);};},getSnapshot:()=>state,
 createProject(name){return mutate(async()=>{const p=await request<Project>('/projects',json('POST',{name}));emit({activeProjectId:p.id});return p;});},
 async selectProject(id){project(id);emit({activeProjectId:id});remember(id);},
 renameProject(id,name){return mutate(async()=>{await request(`/projects/${id}`,json('PATCH',{name}));});},
 deleteProject(id){return mutate(async()=>{await request(`/projects/${id}`,{method:'DELETE'});});},
 addClass(id){return mutate(async()=>{await request(`/projects/${id}/classes`,{method:'POST'});});},
 renameClass(id,cid,name){return mutate(async()=>{await request(`/projects/${id}/classes/${cid}`,json('PATCH',{name}));});},
 deleteClass(id,cid){return mutate(async()=>{await request(`/projects/${id}/classes/${cid}`,{method:'DELETE'});});},
 addImages(id,cid,files){return mutate(async()=>{
  if(files.length>50)throw new Error('一次最多添加 50 张图片。');
  // Validate the entire batch before starting uploads. Server validates decoded content again.
  for(const file of files)await prepareImage(file);
  let count=0;
  for(const file of files){
   try{const result=await request<{added:number}>(`/projects/${id}/classes/${cid}/samples?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type},body:file});count+=result.added;}
   catch(e){throw new Error(`本批已保存 ${count} 张。${message(e)}`);}
  }return count;
 });},
 deleteImage(id,cid,sid){return mutate(async()=>{await request(`/projects/${id}/classes/${cid}/samples/${sid}`,{method:'DELETE'});});},
 updateParams(id,values:Partial<TrainingParams>){return mutate(async()=>{await request(`/projects/${id}/params`,json('PUT',{...project(id).params,...values}));});},
 startTraining(id){return mutate(()=>request<TrainingRun>(`/projects/${id}/training-runs`,{method:'POST'}));},
 cancelTraining(id){return mutate(async()=>{await request(`/projects/${id}/training-runs/cancel`,{method:'POST'});});},
 async predict(id,dataUrl,signal,record=true){
  if(!dataUrl.startsWith('data:image/'))throw new Error('测试图片无效。');
  const blob=await(await fetch(dataUrl)).blob();
  return request<Prediction>(`/projects/${id}/predictions?record=${record}`,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal});
 },
 exportRecord(id){const p=project(id);return JSON.stringify({format:'vision-lab-training-record',version:2,isMock:false,exportedAt:new Date().toISOString(),notice:'真实训练与验证记录，不含图片或模型权重；验证准确率不代表独立测试准确率。',project:{...p,classes:p.classes.map(c=>({...c,samples:c.samples.map(({dataUrl,...s})=>{void dataUrl;return s;})}))}},null,2);},
 dismissNotice(){emit({notice:null});},
};
