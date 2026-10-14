import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Collapse,Input,Segmented,Tag} from 'antd';
import {DatabaseOutlined,LoadingOutlined} from '@ant-design/icons';
import AssistantShell from './AssistantShell';
import DemoExperimentAssistant from './DemoExperimentAssistant';
import type {Prediction,Project} from '../types';
import type {HelpTopic} from '../services/assistant';
import {captureExperiment} from '../services/assistant';
import {isRealTraining} from '../services/api';
import {tutorRequest} from '../services/agentApi';
import type {TutorMode,TutorThread,TutorOverview,TutorNote} from '../services/agentApi';

export interface AssistantEntry {topic:HelpTopic;nonce:number}
interface Props {project:Project;prediction:Prediction|null;entry:AssistantEntry|null;onClose:()=>void;testedRunId?:string|null}
const toolLabels:Record<string,string>={get_experiment_state:'实验状态',get_operation_guide:'操作指南',list_training_runs:'训练记录',get_training_details:'训练详情',compare_training_runs:'实验对比',get_test_records:'测试记录'};
const modes={basic:'基础讲解',advanced:'进阶讲解'};
const noteKinds={feedback:'学生反馈',conclusion:'待验证结论',todo:'待办实验'};
const errorText=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试。';
const prefKey=(id:string)=>`vision-lab:tutor-mode:${id}`;
const threadKey=(id:string)=>`vision-lab:tutor-thread:${id}`;
function readLocal(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function saveLocal(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* server history still works */}}

function RealAssistant({project,prediction,entry,onClose,testedRunId}:Props){
 const [mode,setMode]=useState<TutorMode>(()=>readLocal(prefKey(project.id))==='advanced'?'advanced':'basic');
 const [overview,setOverview]=useState<TutorOverview|null>(null);
 const [thread,setThread]=useState<TutorThread|null>(null);
 const [draft,setDraft]=useState('');const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);const [confirmClear,setConfirmClear]=useState(false);
 const [reload,setReload]=useState(0);
 const [runId,setRunId]=useState<string|undefined>();const [compareId,setCompareId]=useState<string|undefined>();
 const [note,setNote]=useState('');const [noteKind,setNoteKind]=useState<TutorNote['kind']>('todo');const [notesOpen,setNotesOpen]=useState<string[]>([]);
 const alive=useRef(true);const sending=useRef(false);
 const retry=useRef<{key:string;requestId:string}|null>(null);
 const context=captureExperiment(project,prediction);const selectedRun=project.runs.find(r=>r.id===runId);
 const chosenRun=selectedRun?.id??project.runs[0]?.id;
 const total=project.classes.reduce((n,c)=>n+c.samples.length,0);
 const disabled=loading||busy;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const adopt=(d:TutorThread)=>{setThread(d);saveLocal(threadKey(project.id),d.id);};
 useEffect(()=>{
  if(!entry||sending.current)return;
  const controller=new AbortController();let active=true;
  setLoading(true);setError(null);
  (async()=>{
   try{
    const info=await tutorRequest<TutorOverview>(project.id,'','GET',undefined,controller.signal);
    const saved=readLocal(threadKey(project.id));const tid=info.threads.find(t=>t.id===saved)?.id??info.threads[0]?.id;
    const data=tid?await tutorRequest<TutorThread>(project.id,`/threads/${tid}`,'GET',undefined,controller.signal):null;
    if(active){setOverview(info);if(data)adopt(data);else setThread(null);}
   }catch(e){if(active)setError(errorText(e));}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;controller.abort();};
 },[project.id,!!entry,reload]);
 useEffect(()=>{if(entry?.topic==='samples')setDraft('帮我检查样本分布，并说明下一步怎么做。');if(entry?.topic==='training')setDraft('我该怎样理解这次训练结果？');if(entry?.topic==='testing')setDraft('我该怎样测试和比较识别结果？');},[entry?.nonce]);
 const refresh=async()=>{const info=await tutorRequest<TutorOverview>(project.id);if(alive.current)setOverview(info);};
 const newThread=async()=>{
  if(disabled)return;setLoading(true);setError(null);
  try{const data=await tutorRequest<TutorThread>(project.id,'/threads','POST',{mode});if(alive.current){adopt(data);setDraft('');}await refresh();}
  catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setLoading(false);}
 };
 const chooseThread=async(id:string)=>{
  if(disabled)return;setLoading(true);setError(null);
  try{const data=await tutorRequest<TutorThread>(project.id,`/threads/${id}`);if(alive.current){adopt(data);setDraft('');}}
  catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setLoading(false);}
 };
 const send=async(question:string,action:'question'|'next'|'explain'|'compare'='question')=>{
  if(sending.current||loading||!question.trim())return;
  if(!overview?.configured){setError('尚未配置百炼接口和 API Key。请运行“配置实验助手.cmd”并重启后端，再点击重新加载。');return;}
  if(action==='compare'&&(!chosenRun||!compareId||chosenRun===compareId)){setError('请先在上方选择两次不同的训练。');return;}
  sending.current=true;setBusy(true);setError(null);setDraft(question);
  try{
   const current=thread??await tutorRequest<TutorThread>(project.id,'/threads','POST',{mode});
   if(alive.current&&!thread)adopt(current);
   const requestKey=JSON.stringify([current.id,question.trim(),mode,action,chosenRun,compareId,testedRunId]);
   if(retry.current?.key!==requestKey)retry.current={key:requestKey,requestId:crypto.randomUUID()};
   const response=await tutorRequest<{thread:TutorThread}>(project.id,`/threads/${current.id}/messages`,'POST',{
    requestId:retry.current.requestId,question:question.trim(),mode,action,runId:chosenRun??null,compareRunId:action==='compare'?compareId:null,
    client:{testedRunId:testedRunId??null},
   });
   retry.current=null;
   if(alive.current){adopt(response.thread);setDraft('');}await refresh();
  }catch(e){if(alive.current)setError(errorText(e));}
  finally{sending.current=false;if(alive.current)setBusy(false);}
 };
 const removeThread=async()=>{
  if(!thread||disabled)return;setLoading(true);setError(null);
  try{await tutorRequest(project.id,`/threads/${thread.id}`,'DELETE');if(alive.current){setThread(null);setConfirmClear(false);setReload(v=>v+1);}}
  catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setLoading(false);}
 };
 const saveNote=async()=>{
  if(disabled||!note.trim())return;setLoading(true);setError(null);
  try{await tutorRequest(project.id,'/notes','POST',{text:note.trim(),kind:noteKind,runId:chosenRun??null});if(alive.current)setNote('');await refresh();}
  catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setLoading(false);}
 };
 const deleteNote=async(id:string)=>{
  if(disabled)return;setLoading(true);setError(null);
  try{await tutorRequest(project.id,`/notes/${id}`,'DELETE');await refresh();}
  catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setLoading(false);}
 };
 const runOptions=project.runs.map((r,i)=>({value:r.id,label:`第 ${project.runs.length-i} 次 · ${r.status==='completed'?'已完成':r.status==='running'?'训练中':r.status==='failed'?'失败':'已取消'} · ${r.id.slice(0,6)}`}));
 const messages=thread?.messages??[];
 return <AssistantShell open={!!entry} onClose={onClose} title="实验辅导助手" subtitle="结合你的实验记录，解释结果并指导下一步"
  statusLabel={overview?.configured?'AI 辅导 · 只读实验数据':'等待配置百炼接口'} statusDetail={modes[mode]} busy={disabled}
  clearLabel="删除当前对话" clearPrompt="删除当前对话？项目笔记和实验记录会保留。"
  context={<div className="tutor-context">
   <div className="tutor-project"><strong title={project.name}>{project.name}</strong><Tag color="blue">{context.stage}</Tag></div>
   <div className="tutor-stats">{project.classes.length} 个类别 · {total} 张图片 · 数据版本 {project.revision}</div>
   <Segmented block aria-label="助手讲解模式" value={mode} disabled={disabled} options={[{label:'基础讲解',value:'basic'},{label:'进阶讲解',value:'advanced'}]} onChange={v=>{setMode(v as TutorMode);saveLocal(prefKey(project.id),v as string);}}/>
   <p className="tutor-hint">每次只按选中的模式回答，历史回答保持原样。</p>
   <div className="tutor-thread-row"><select aria-label="历史辅导对话" value={thread?.id??''} disabled={disabled} onChange={e=>void chooseThread(e.target.value)}><option value="" disabled>新对话</option>{overview?.threads.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select><Button size="small" disabled={disabled} onClick={()=>void newThread()}>新建对话</Button></div>
   <details className="tutor-runs"><summary>{chosenRun?`参考训练：${runOptions.find(r=>r.value===chosenRun)?.label}`:'暂无训练记录'}</summary><div className="tutor-run-selects"><select aria-label="参考训练记录" value={chosenRun??''} disabled={disabled} onChange={e=>setRunId(e.target.value)}><option value="" disabled>选择训练记录</option>{runOptions.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select><select aria-label="对比训练记录" value={compareId??''} disabled={disabled} onChange={e=>setCompareId(e.target.value||undefined)}><option value="">比较时再选择另一条</option>{runOptions.filter(r=>r.value!==chosenRun).map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></div></details>
   {!overview?.configured&&overview&&<p className="tutor-hint">在本机运行“配置实验助手.cmd”后重启后端。未配置时不会生成模拟回答。</p>}
   <Button type="link" size="small" disabled={disabled} onClick={()=>setReload(v=>v+1)}>重新加载</Button>
  </div>}
  welcomeTitle="一起把实验做明白" welcomeText="可以问下一步怎么操作，也可以让我结合记录解释训练结果。不会读取或上传图片。" capabilities={['操作指导','结果分析','实验对比']}
  prompts={[{label:'下一步做什么',onClick:()=>void send('我下一步应该做什么，具体怎么操作？','next')},{label:'解释训练结果',onClick:()=>void send('请结合选中的训练记录解释结果，指出证据和局限。','explain')},{label:'比较两次训练',onClick:()=>void send('请比较选中的两次训练，说明变化和下一步建议。','compare')}]}
  draft={draft} onDraftChange={setDraft} onSend={()=>void send(draft)} inputLabel="向实验助手提问" placeholder="例如：这次准确率是 95%，下一步怎么验证？" messageCount={messages.length+(busy?1:0)} storageError={error}
  confirmClear={confirmClear} onRequestClear={()=>setConfirmClear(true)} onCancelClear={()=>setConfirmClear(false)} onClear={()=>void removeThread()}
  localNote="对话按项目保存在后端。发送问题会将必要的文字与实验摘要交给百炼，不发送照片。">
   {messages.map(m=><div key={m.id} className={`assistant-message ${m.role}`}>
    <div className="assistant-message-label">{m.role==='user'?'你':`实验助手 · ${modes[m.mode]}`}</div>
    <div className="assistant-bubble">{m.text}</div>
    {m.contextChanged&&<Alert type="info" message="回答期间实验发生变化，请以最新状态为准。"/>}
    {m.role==='assistant'&&<>
     <details className="assistant-evidence"><summary><DatabaseOutlined/> 本次参考与用量</summary>
      <p>数据版本 {m.revision} · {m.usage?.total_tokens??0} tokens（工具查询摘要计入输入）</p>
      {!m.evidence?.length&&<p>本次未查询实验工具。</p>}
      {m.evidence?.map((e,i)=><details key={i}><summary>{toolLabels[e.tool]??'工具调用'} · {e.ok?'已读取':'未成功'} · {new Date(e.capturedAt).toLocaleTimeString('zh-CN')}</summary><pre>{JSON.stringify(e.result,null,2)}</pre></details>)}
     </details>
     <Button size="small" type="link" disabled={disabled} onClick={()=>{setNote(m.text.slice(0,600));setNoteKind('conclusion');setNotesOpen(['notes']);}}>整理为项目笔记</Button>
    </>}
   </div>)}
   {busy&&<div className="tutor-pending" role="status"><LoadingOutlined/> 正在按需查询实验记录并组织回答…</div>}
   <Collapse ghost activeKey={notesOpen} onChange={keys=>setNotesOpen(typeof keys==='string'?[keys]:keys)} items={[{key:'notes',label:`项目笔记（${overview?.notes.length??0}）`,children:<div className="tutor-notes">
    <p className="tutor-hint">新对话可读取最近 8 条笔记。内容由你确认保存，反馈和结论不自动视为已核验事实。</p>
    {overview?.notes.map(n=><div className="tutor-note" key={n.id}><Tag>{noteKinds[n.kind]}</Tag><span>{n.text}</span>{n.runId&&<small>训练 {n.runId.slice(0,6)}</small>}<Button type="link" size="small" danger disabled={disabled} onClick={()=>void deleteNote(n.id)}>删除笔记</Button></div>)}
    <select aria-label="笔记类型" value={noteKind} disabled={disabled} onChange={e=>setNoteKind(e.target.value as TutorNote['kind'])}>{Object.entries(noteKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    <Input.TextArea aria-label="项目笔记内容" value={note} disabled={disabled} maxLength={600} rows={3} onChange={e=>setNote(e.target.value)} placeholder="记录待验证的想法，或你观察到的误分类。"/>
    <Button size="small" disabled={disabled||!note.trim()} onClick={()=>void saveNote()}>保存项目笔记</Button>
   </div>}]} />
  </AssistantShell>;
}

export default function ExperimentAssistant(props:Props){return isRealTraining?<RealAssistant key={props.project.id} {...props}/>:<DemoExperimentAssistant {...props}/>;}
