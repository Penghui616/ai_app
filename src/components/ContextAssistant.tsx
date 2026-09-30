import { useState } from 'react';
import { Button, Tag } from 'antd';
import { CommentOutlined } from '@ant-design/icons';
import AssistantShell from './AssistantShell';
import { readAssistantHistory, saveAssistantHistory, HISTORY_LIMIT } from '../services/assistant';
import type { AssistantMessage } from '../services/assistant';

interface Props { mode: 'navigation' | 'experience'; context: string; onExperience: () => void; onTraining: () => void }
export default function ContextAssistant({ mode, context, onExperience, onTraining }: Props) {
  const key = `app-${mode}-v1`;
  const [initial] = useState(() => readAssistantHistory(key));
  const [messages, setMessages] = useState<AssistantMessage[]>(initial.messages);
  const [error, setError] = useState(initial.error);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  const navigation = mode === 'navigation';
  const title = navigation ? '应用导航助手' : '图像体验助手';
  const choices = navigation ? [
    { label: '我该选哪个', question: '第一次使用，我该选哪个应用？', answer: '可以从“图像分类体验”开始：上传图片，熟悉输入与结果展示。如果想理解模型如何从数据中学习，再进入“图像分类实验”。两个应用目前都为前端演示。' },
    { label: '体验和训练的区别', question: '体验和训练有什么不同？', answer: '体验应用预设分类范围，重点是观察结果；训练应用允许你自定义类别、准备样本、调整训练配置。当前尚未接入真实识别与训练，不能用演示分数判断模型效果。' },
    { label: '还有哪些应用', question: '还能体验语音和翻译吗？', answer: '语音识别、语音交互和翻译尚未开放。目前可进入图像分类体验和图像分类实验。' },
  ] : [
    { label: '能识别什么', question: '这个体验任务能识别什么？', answer: '当前使用“水果分类 · 界面示例”，预设苹果、香蕉、橙子三个类别。它还没有连接识别模型，上传任意图片都会显示同一组演示分数。真实支持范围会在模型接入后确定。' },
    { label: '怎样做对比', question: '换角度或背景后应该怎样比较？', answer: '真实识别接入后，可以选择同一个物体，只改变角度或背景中的一个因素，再比较结果。现在可以练习上传、记录观察与保存体验记录，但演示分数不能验证你的猜想。' },
    { label: '分数代表什么', question: '预测分数就是准确率吗？', answer: '不是。真实模型的单张图片分数表示其判断倾向，不等于整体准确率，也不能直接当作答对概率。当前显示的 62%、24%、14% 只是固定的界面演示数值。' },
  ];
  const persist = (next: AssistantMessage[]) => { setMessages(next); setError(saveAssistantHistory(key, next) ? null : '辅导记录未保存，浏览器存储可能不足。'); };
  const send = (question: string, answer?: string) => {
    if (!question.trim()) return;
    persist([...messages,
      { id: crypto.randomUUID(), role: 'user', text: question.trim() } as AssistantMessage,
      { id: crypto.randomUUID(), role: 'assistant', text: (answer ?? '当前是前端助手演示，尚未连接大模型，无法回答任意问题。可以使用下方快捷问题查看预设介绍。') + '\n\n本次页面信息：' + context } as AssistantMessage,
    ].slice(-HISTORY_LIMIT)); setDraft('');
  };
  return <><Button className="assistant-launcher" type="primary" size="large" icon={<CommentOutlined aria-hidden="true" />} onClick={() => setOpen(true)} aria-expanded={open} aria-label={title+' 演示'}>{title}<span>演示</span></Button>
    <AssistantShell open={open} onClose={() => { setOpen(false); setConfirm(false); }} title={title} subtitle={navigation ? '帮你找到适合的探索起点' : '观察输入与结果，提出自己的猜想'}
      context={<div className="assistant-context"><div className="assistant-context-top"><span>{navigation ? '应用目录' : '当前体验'}</span><Tag color="blue" bordered={false}>{navigation ? '应用推荐' : '体验指导'}</Tag></div><p>{context}</p>{navigation && <div className="assistant-navigation-actions"><Button size="small" onClick={onExperience}>去图像体验</Button><Button size="small" onClick={onTraining}>去分类实验</Button></div>}</div>}
      welcomeTitle={navigation ? '你想从哪里开始？' : '换个视角，会有什么不同？'} welcomeText={navigation ? '先体验已有应用，或自己准备数据训练模型。选择适合你的探索方式。' : '关注图片的变化，记录你的发现。真正的识别效果需要接入模型后验证。'} capabilities={navigation ? ['了解应用','选择任务','开始探索'] : ['观察结果','比较输入','记录发现']}
      prompts={choices.map(item => ({ label: item.label, onClick: () => send(item.question, item.answer) }))}
      draft={draft} onDraftChange={setDraft} onSend={() => send(draft)} inputLabel={navigation ? '向导航助手提问' : '向体验助手提问'} placeholder={navigation ? '例如：体验和训练有什么区别？' : '例如：换一个背景会影响结果吗？'}
      messageCount={messages.length} storageError={error} confirmClear={confirm} onRequestClear={() => setConfirm(true)} onCancelClear={() => setConfirm(false)} onClear={() => { persist([]); setConfirm(false); }} localNote="此应用的最近 20 轮对话仅保存在本机，与其他助手分别保存。">
      {messages.map(item => <div className={`assistant-message ${item.role}`} key={item.id}><div className="assistant-message-label">{item.role === 'user' ? '你' : title + ' · 演示回复'}</div><div className="assistant-bubble">{item.text}</div></div>)}
    </AssistantShell></>;
}
