export type TutorMode = 'basic' | 'advanced';
export interface TutorEvidence {tool:string;ok:boolean;revision:number;capturedAt:string;arguments:Record<string,unknown>;result:unknown}
export interface TutorMessage {id:string;role:'user'|'assistant';text:string;mode:TutorMode;createdAt:string;runId?:string|null;revision?:number;contextChanged?:boolean;evidence?:TutorEvidence[];usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}}
export interface TutorThread {id:string;title:string;mode:TutorMode;updatedAt:string;messages:TutorMessage[];historyDigest:string}
export interface TutorNote {id:string;text:string;kind:'feedback'|'conclusion'|'todo';runId:string|null;createdAt:string}
export interface TutorOverview {configured:boolean;model:string;threads:Pick<TutorThread,'id'|'title'|'mode'|'updatedAt'>[];notes:TutorNote[]}
export async function tutorRequest<T>(pid:string,path='',method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const controller=new AbortController();const abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,110000);
 try{
  const response=await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/assistant${path}`,{method,credentials:'same-origin',signal:controller.signal,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(typeof result?.detail==='string'?result.detail:`助手请求失败（${response.status}），请稍后重试。`);
  return result as T;
 }catch(e){if(controller.signal.aborted)throw new Error('请求已中止或超时。可重新加载对话确认是否已保存回答。');if(e instanceof TypeError)throw new Error('无法连接助手后端，请检查后端是否已启动。');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
