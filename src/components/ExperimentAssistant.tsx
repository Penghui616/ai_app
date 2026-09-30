import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Tag } from 'antd';
import { ArrowUpOutlined, BulbOutlined, CloseOutlined, CommentOutlined, DatabaseOutlined, DeleteOutlined, ExperimentOutlined } from '@ant-design/icons';
import type { Prediction, Project } from '../types';
import { captureExperiment, getDemoReply, HISTORY_LIMIT, readAssistantHistory, saveAssistantHistory } from '../services/assistant';
import type { AssistantMessage, HelpTopic } from '../services/assistant';

export interface AssistantEntry { topic: HelpTopic; nonce: number }
interface Props {
  project: Project;
  prediction: Prediction | null;
  entry: AssistantEntry | null;
  onClose: () => void;
}
const prompts: { label: string; question: string; topic: HelpTopic }[] = [
  { label: '检查样本', question: '帮我检查当前的样本分布。', topic: 'samples' },
  { label: '理解训练', question: '我该怎样理解训练过程？', topic: 'training' },
  { label: '测试建议', question: '我该怎样测试和比较结果？', topic: 'testing' },
];

export default function ExperimentAssistant({ project, prediction, entry, onClose }: Props) {
  const [history] = useState(() => readAssistantHistory(project.id));
  const [messages, setMessages] = useState<AssistantMessage[]>(history.messages);
  const [storageError, setStorageError] = useState(history.error);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic>('question');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<React.ComponentRef<typeof Input.TextArea>>(null);
  const context = captureExperiment(project, prediction);
  const total = context.classes.reduce((sum, item) => sum + item.count, 0);

  useEffect(() => {
    if (!entry) return;
    setConfirmClear(false);
    setSelectedTopic(entry.topic);
    setDraft(prompts.find(item => item.topic === entry.topic)?.question ?? '');
  }, [entry]);
  useEffect(() => { if (entry) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, entry]);

  const persist = (next: AssistantMessage[]) => {
    setMessages(next);
    setStorageError(saveAssistantHistory(project.id, next) ? null : '对话暂未保存，可能是浏览器存储空间不足。刷新前请保留需要的内容。');
  };
  const send = (question: string, topic: HelpTopic) => {
    if (!question.trim()) return;
    const snapshot = captureExperiment(project, prediction);
    const reply = getDemoReply({ question: question.trim(), topic, context: snapshot });
    persist([...messages,
      { id: crypto.randomUUID(), role: 'user', text: question.trim() } as AssistantMessage,
      { id: crypto.randomUUID(), role: 'assistant', text: reply.text, context: reply.context } as AssistantMessage,
    ].slice(-HISTORY_LIMIT));
    setDraft(''); setSelectedTopic('question');
    inputRef.current?.focus();
  };

  return <Drawer open={!!entry} onClose={onClose} placement="right" width="min(440px, 100vw)" mask={false}
    rootClassName="experiment-assistant" closeIcon={<CloseOutlined aria-label="收起实验助手" />}
    title={<div className="assistant-title"><span className="assistant-symbol"><CommentOutlined aria-hidden="true" /></span><div><b>实验助手</b><small>图像分类 · 陪你理解每一次实验</small></div></div>}
    extra={<Button type="text" size="small" aria-label="清空辅导记录" disabled={!messages.length} onClick={() => setConfirmClear(true)} icon={<DeleteOutlined aria-hidden="true" />} />}
    styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }, header: { padding: '20px 16px' } }}>
    <div className="assistant-mode"><span className="assistant-mode-dot" />助手演示 · 尚未接入 AI<span>预设回复</span></div>
    {confirmClear && <div className="assistant-clear-confirm" role="alert"><span>清空当前项目的辅导记录？</span><Button size="small" onClick={() => setConfirmClear(false)}>保留</Button><Button size="small" danger onClick={() => { persist([]); setConfirmClear(false); }}>清空</Button></div>}
    <div className="assistant-context" data-testid="assistant-context">
      <div className="assistant-context-top"><span><ExperimentOutlined aria-hidden="true" /> 当前实验</span><Tag bordered={false} color="blue">{context.stage}</Tag></div>
      <strong title={project.name}>{project.name}</strong>
      <div className="assistant-stat-row"><span>{context.classes.length} 个类别</span><span>{total} 张图片</span><span>数据版本 {project.revision}</span></div>
      <p>状态由程序统计；训练与预测仍为模拟。</p>
    </div>
    {storageError && <Alert className="assistant-storage-error" type="warning" showIcon message={storageError} />}
    <div className="assistant-conversation" role="log" aria-label="实验辅导对话" aria-live="polite" aria-relevant="additions">
      <div className="assistant-welcome">
        <span className="assistant-welcome-icon"><BulbOutlined aria-hidden="true" /></span>
        <h3>从一个好问题开始</h3>
        <p>一起观察数据、提出猜想，再用实验验证。你想先了解哪一部分？</p>
        <div className="assistant-capabilities"><span>理解概念</span><span>寻找依据</span><span>设计验证</span></div>
      </div>
      {messages.map(message => <div key={message.id} className={`assistant-message ${message.role}`}>
        <div className="assistant-message-label">{message.role === 'user' ? '你' : '实验助手 · 演示回复'}</div>
        <div className="assistant-bubble">{message.text}</div>
        {message.context && <details className="assistant-evidence"><summary><DatabaseOutlined aria-hidden="true" /> 本次参考的实验数据</summary>
          <p>{message.context.projectName} · 数据版本 {message.context.revision}</p>
          <p>读取于 {new Date(message.context.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}，这是回答时的快照。</p>
          <ul>{message.context.classes.map((item, index) => <li key={index}>{item.name}：{item.count} 张</li>)}</ul>
          <p>{message.context.run ? '训练记录：模拟记录，未用于判断真实效果。' : '训练记录：暂无。'}</p>
          <p>{message.context.hasPrediction ? '当前测试：模拟预测，不用于效果分析。' : '当前测试：暂无可用预测。'}</p>
          <p>未读取图片内容；没有执行任何修改操作。</p>
        </details>}
      </div>)}
      <div ref={endRef} />
    </div>
    <div className="assistant-composer">
      <div className="assistant-prompts">{prompts.map(item => <Button key={item.topic} size="small" onClick={() => send(item.question, item.topic)}>{item.label}</Button>)}</div>
      <div className="assistant-input-box"><Input.TextArea ref={inputRef} aria-label="向实验助手提问" placeholder="例如：把同一张图片复制多遍有用吗？" value={draft} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} variant="borderless"
        onChange={event => { setDraft(event.target.value); setSelectedTopic('question'); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft, selectedTopic); } }} />
        <div className="assistant-input-bottom"><span>{draft.length}/1000 · Shift+Enter 换行</span><Button type="primary" shape="circle" aria-label="发送问题" disabled={!draft.trim()} icon={<ArrowUpOutlined aria-hidden="true" />} onClick={() => send(draft, selectedTopic)} /></div>
      </div>
      <p className="assistant-local-note">仅本机保存最近 20 轮对话，按项目隔离；清理浏览器数据会删除记录。</p>
    </div>
  </Drawer>;
}
