import type { ClassificationApi } from './contracts';
import { loadWorkspace, saveWorkspace } from './repository';
import { fingerprint, prepareImage } from './images';
import { CLASS_COLORS, DEFAULT_PARAMS } from '../types';
import type { Project, WorkspaceState, TrainingRun, TrainingParams, Prediction } from '../types';

let state: WorkspaceState = { ready:false, projects:[], activeProjectId:null, saveStatus:'saved',error:null,notice:null };
const listeners = new Set<() => void>();
const timers = new Map<string,ReturnType<typeof setTimeout>>();
let initialization: Promise<void> | null = null;
let pendingWrite: Promise<void> = Promise.resolve();
let memoryOnly = false;
const now=()=>new Date().toISOString();
const emit=()=>listeners.forEach(listener=>listener());
function updateState(value:Partial<WorkspaceState>) { state={...state,...value};emit(); }
function nameValue(value:string) { const name=value.trim();if(!name||name.length>40) throw new Error('名称请填写 1–40 个字符。');return name; }
function getProject(id:string) { const project=state.projects.find(item=>item.id===id);if(!project)throw new Error('项目不存在或已被删除。');return project; }
function editable(project:Project) { if(project.runs.some(run=>run.status==='running'))throw new Error('请先完成或取消训练，再修改样本和参数。'); }
function createProject(name:string):Project { const time=now();return {id:crypto.randomUUID(),name:nameValue(name),createdAt:time,updatedAt:time,revision:0,classes:['类别1','类别2'].map((name,index)=>({id:crypto.randomUUID(),name,color:CLASS_COLORS[index],samples:[]})),params:{...DEFAULT_PARAMS},runs:[]}; }
async function commit(projects:Project[],activeProjectId=state.activeProjectId) {
 updateState({projects,activeProjectId,saveStatus:memoryOnly?'error':'saving'});
 if(memoryOnly)return;
 const record={version:1 as const,projects,activeProjectId};
 const write=pendingWrite.catch(()=>{}).then(()=>saveWorkspace(record));
 pendingWrite=write;
 try{await write;if(pendingWrite===write)updateState({saveStatus:'saved',error:null});}
 catch {updateState({saveStatus:'error',error:'本地保存失败，可能是浏览器空间不足或存储受限。当前内容仍在页面中，请先导出实验记录，或删除不需要的图片。'});throw new Error('浏览器未能保存本次更改。');}
}
async function changeProject(projectId:string,change:(project:Project)=>Project) {
 const project=getProject(projectId);const next={...change(project),updatedAt:now()};
 await commit(state.projects.map(item=>item.id===projectId?next:item));
}
function validateParams(params:TrainingParams) {
 if(params.imageSize!==224)throw new Error('当前演示固定使用 224 × 224 输入。');
 if(!Number.isInteger(params.epochs)||params.epochs<1||params.epochs>100)throw new Error('训练轮数需要是 1–100 的整数。');
 if(![4,8,16,32,64].includes(params.batchSize))throw new Error('请选择有效的批大小。');
 if(!Number.isFinite(params.learningRate)||params.learningRate<0.00001||params.learningRate>1)throw new Error('学习率需在 0.00001–1 之间。');
 if(!['AdamW','SGD'].includes(params.optimizer))throw new Error('优化器无效。');
}
function matchingRun(project:Project) { return project.runs.find(run=>run.status==='completed'&&run.revision===project.revision); }
function schedule(projectId:string,runId:string,delay:number) {
 timers.set(projectId,setTimeout(()=>void tick(projectId,runId,delay),delay));
}
async function tick(projectId:string,runId:string,delay:number) {
 const project=state.projects.find(p=>p.id===projectId);const run=project?.runs.find(r=>r.id===runId);
 if(!project||!run||run.status!=='running')return;
 const epoch=run.metrics.length+1;const fraction=epoch/run.params.epochs;
 // Intentionally synthetic. No pixels are used, no ML model is loaded, and no network request is made.
 const metric={epoch,trainLoss:Number((0.83*Math.exp(-fraction*2.2)+0.09+Math.sin(epoch)*0.012).toFixed(4)),valLoss:Number((0.63*Math.exp(-fraction*1.2)+0.16+Math.sin(epoch*.7)*.007).toFixed(4)),accuracy:Number(Math.min(.9,.43+.42*fraction+Math.sin(epoch*.8)*.016).toFixed(4))};
 const finished=epoch>=run.params.epochs;
 const next:TrainingRun={...run,metrics:[...run.metrics,metric],status:finished?'completed':'running',finishedAt:finished?now():undefined,message:finished?'演示训练完成。以上曲线和指标为模拟数据，未生成真实模型。':'正在生成模拟训练指标，未执行真实模型训练。'};
 try{
  await changeProject(projectId,p=>({...p,runs:p.runs.map(r=>r.id===runId?next:r)}));
  if(finished)timers.delete(projectId);else if(getProject(projectId).runs.find(r=>r.id===runId)?.status==='running')schedule(projectId,runId,delay);
 }catch{
  timers.delete(projectId);
  updateState({projects:state.projects.map(p=>p.id===projectId?{...p,runs:p.runs.map(r=>r.id===runId?{...r,status:'failed' as const,message:'演示任务因本地保存失败而停止。',finishedAt:now()}:r)}:p)});
 }
}
export const mockApi:ClassificationApi={
 initialize(){
  if(initialization)return initialization;
  initialization=(async()=>{
   try{
    const saved=await loadWorkspace();let projects=saved?.version===1?saved.projects:[]; projects=projects.map(p=>p.name==='我的第一个分类实验'&&p.runs.length===0&&p.classes.length===2&&p.classes.every(c=>c.samples.length===0)&&p.classes.map(c=>c.name).join('|')==='猫|狗'?{...p,classes:p.classes.map((c,i)=>({...c,name:'类别'+(i+1)}))}:p);
    let interrupted=false;
    projects=projects.map(p=>({...p,runs:p.runs.map(r=>r.status==='running'?(interrupted=true,{...r,status:'cancelled' as const,finishedAt:now(),message:'页面重新加载，纯前端演示任务已停止，可重新开始。'}):r)}));
    if(!projects.length&&!saved)projects=[createProject('我的第一个分类实验')];
    const active=projects.some(p=>p.id===saved?.activeProjectId)?saved!.activeProjectId:projects[0]?.id??null;
    updateState({ready:true,projects,activeProjectId:active,notice:interrupted?'上次演示在页面关闭时停止，已保留运行记录。可以重新开始。':null});
    await commit(projects,active);
   }catch{
    memoryOnly=true;
    const projects=state.projects.length?state.projects:[createProject('我的第一个分类实验')];
    updateState({ready:true,projects,activeProjectId:projects[0]?.id??null,saveStatus:'error',error:'浏览器存储不可用，当前使用临时模式，刷新后可能丢失内容。请使用普通浏览窗口。'});
   }
  })();return initialization;
 },
 subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
 getSnapshot:()=>state,
 async createProject(name){const project=createProject(name);await commit([project,...state.projects],project.id);return project;},
 async selectProject(id){getProject(id);await commit(state.projects,id);},
 async renameProject(id,name){await changeProject(id,p=>({...p,name:nameValue(name)}));},
 async deleteProject(id){editable(getProject(id));clearTimeout(timers.get(id));timers.delete(id);const projects=state.projects.filter(p=>p.id!==id);await commit(projects,state.activeProjectId===id?projects[0]?.id??null:state.activeProjectId);},
 async addClass(id){await changeProject(id,p=>{editable(p);if(p.classes.length>=8)throw new Error('前端演示最多支持 8 个类别。');let index=p.classes.length+1;while(p.classes.some(c=>c.name==='类别'+index))index++;return {...p,revision:p.revision+1,classes:[...p.classes,{id:crypto.randomUUID(),name:'类别'+index,color:CLASS_COLORS[p.classes.length%CLASS_COLORS.length],samples:[]}]};});},
 async renameClass(id,classId,value){const name=nameValue(value);await changeProject(id,p=>{editable(p);if(p.classes.some(c=>c.id!==classId&&c.name.toLowerCase()===name.toLowerCase()))throw new Error('这个类别名称已经存在。');if(!p.classes.some(c=>c.id===classId))throw new Error('类别不存在。');return {...p,revision:p.revision+1,classes:p.classes.map(c=>c.id===classId?{...c,name}:c)};});},
 async deleteClass(id,classId){await changeProject(id,p=>{editable(p);if(p.classes.length<=2)throw new Error('图像分类至少保留两个类别。');return {...p,revision:p.revision+1,classes:p.classes.filter(c=>c.id!==classId)};});},
 async addImages(id,classId,files){
  editable(getProject(id));if(!files.length)return 0;
  if(files.length>50)throw new Error('一次最多添加 50 张图片。');
  const prepared=await Promise.all(files.map(prepareImage));let added=0;
  await changeProject(id,p=>{editable(p);const current=p.classes.find(c=>c.id===classId);if(!current)throw new Error('类别不存在。');
   const seen=new Set(current.samples.map(s=>s.fingerprint));const unique=prepared.filter(s=>{if(seen.has(s.fingerprint))return false;seen.add(s.fingerprint);return true;});
   added=unique.length;if(p.classes.reduce((n,c)=>n+c.samples.length,0)+added>200)throw new Error('演示项目最多保存 200 张图片，请先删除部分样本。');
   return {...p,revision:p.revision+(added?1:0),classes:p.classes.map(c=>c.id===classId?{...c,samples:[...c.samples,...unique]}:c)};
  });return added;
 },
 async deleteImage(id,classId,imageId){await changeProject(id,p=>{editable(p);return {...p,revision:p.revision+1,classes:p.classes.map(c=>c.id===classId?{...c,samples:c.samples.filter(s=>s.id!==imageId)}:c)};});},
 async updateParams(id,values){await changeProject(id,p=>{editable(p);const params={...p.params,...values};validateParams(params);return {...p,params};});},
 async startTraining(id){
  const p=getProject(id);editable(p);if(state.projects.some(project=>project.runs.some(r=>r.status==='running')))throw new Error('另一个项目正在演示训练，请先等待完成或取消。');
  if(p.classes.length<2||p.classes.some(c=>!c.samples.length))throw new Error('请至少准备两个类别，并为每个类别添加图片。');
  validateParams(p.params);
  const run:TrainingRun={id:crypto.randomUUID(),projectId:id,revision:p.revision,status:'running',params:{...p.params},metrics:[],startedAt:now(),message:'准备模拟训练，未执行真实模型训练。',sampleCount:p.classes.reduce((n,c)=>n+c.samples.length,0),isMock:true};
  await changeProject(id,current=>({...current,runs:[run,...current.runs].slice(0,12)}));
  schedule(id,run.id,Math.max(120,Math.min(800,12000/run.params.epochs)));return run;
 },
 async cancelTraining(id){
  clearTimeout(timers.get(id));timers.delete(id);
  await changeProject(id,p=>({...p,runs:p.runs.map(r=>r.status==='running'?{...r,status:'cancelled',finishedAt:now(),message:'演示训练已取消。现有曲线仅为模拟记录。'}:r)}));
 },
 async predict(id,dataUrl){
  if(!dataUrl.startsWith('data:image/'))throw new Error('请先选择有效的测试图片。');
  const project=getProject(id);const run=matchingRun(project);if(!run)throw new Error('请先针对当前样本完成一次演示训练。');
  const revision=project.revision;await new Promise(resolve=>setTimeout(resolve,650));
  const current=getProject(id);if(current.revision!==revision)throw new Error('样本已发生变化，请重新演示训练。');
  const seed=parseInt(fingerprint(dataUrl+run.id),16);const winner=seed%project.classes.length;
  const weights=project.classes.map((_,i)=>i===winner?55+seed%20:5+(seed>>>(i%4)*4)%15);const sum=weights.reduce((a,b)=>a+b,0);
  const result:Prediction={isMock:true,runId:run.id,scores:project.classes.map((c,i)=>({classId:c.id,name:c.name,color:c.color,score:weights[i]/sum}))};return result;
 },
 exportRecord(id){
  const p=getProject(id);
  return JSON.stringify({format:'vision-lab-demo-record',version:1,exportedAt:now(),isMock:true,notice:'前端演示记录，不包含真实模型权重或真实训练指标。图片仅导出元数据。',project:{...p,classes:p.classes.map(c=>({...c,samples:c.samples.map(({dataUrl: _preview,...sample})=>{void _preview;return sample;})}))}},null,2);
 },
 dismissNotice(){updateState({notice:null});},
};
