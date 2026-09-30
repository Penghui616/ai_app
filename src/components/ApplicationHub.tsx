import { Button, Tag } from 'antd';
import { ArrowRightOutlined, AudioOutlined, CameraOutlined, ExperimentOutlined, MessageOutlined, TranslationOutlined } from '@ant-design/icons';
import ContextAssistant from './ContextAssistant';
interface Props { onExperience: () => void; onTraining: () => void }
export default function ApplicationHub({ onExperience, onTraining }: Props) {
  return <div className="application-hub">
    <section className="hub-hero"><div className="hub-hero-copy"><div className="eyebrow">AI LEARNING LAB · 应用探索</div><h1>从一次体验，开始理解 AI</h1><p>让图片变成问题，让实验带来发现。<br/>选择一个应用，开启你的探索。</p><div className="hero-pills"><span>体验应用</span><i>→</i><span>动手实验</span><i>→</i><span>理解原理</span></div></div><div className="hub-illustration" aria-hidden="true"><div className="illustration-input"><CameraOutlined /><span>观察</span></div><div className="illustration-link"/><div className="illustration-model"><ExperimentOutlined /><b>AI</b></div><div className="illustration-link"/><div className="illustration-output"><span/><span/><span/><small>探索结果</small></div><span className="illustration-caption">每一个发现，都从好奇开始</span></div></section>
    <div className="hub-section-heading"><div><h2>选择你的探索方式</h2><p>先感受 AI 能做什么，再探索它如何学习。</p></div><Tag>2 个前端应用</Tag></div>
    <div className="application-grid">
      <article className="application-card experience-app"><div className="application-card-top"><span className="application-icon"><CameraOutlined aria-hidden="true" /></span><Tag color="cyan">先来体验</Tag></div><span className="application-kicker">IMAGE CLASSIFICATION · EXPERIENCE</span><h2>图像分类体验</h2><p>上传一张图片，认识分类结果的展示方式，尝试从不同角度观察同一个物体。</p><div className="application-steps"><span>上传图片</span><i>→</i><span>查看结果</span><i>→</i><span>记录观察</span></div><div className="application-card-footer"><span>无需准备训练数据</span><Button type="primary" onClick={onExperience}>开始体验 <ArrowRightOutlined aria-hidden="true" /></Button></div></article>
      <article className="application-card training-app"><div className="application-card-top"><span className="application-icon"><ExperimentOutlined aria-hidden="true" /></span><Tag color="blue">动手探索</Tag></div><span className="application-kicker">IMAGE CLASSIFICATION · TRAINING</span><h2>图像分类训练</h2><p>自己定义类别、准备图片样本，探索数据、训练设置与分类结果之间的关系。</p><div className="application-steps"><span>准备样本</span><i>→</i><span>训练模型</span><i>→</i><span>测试改进</span></div><div className="application-card-footer"><span>自定义你的分类任务</span><Button type="primary" ghost onClick={onTraining}>进入训练 <ArrowRightOutlined aria-hidden="true" /></Button></div></article>
    </div>
    <div className="hub-demo-note">当前为前端演示：识别与训练均未接入真实模型，助手使用预设回复。</div>
    <section className="coming-section"><h2>接下来，探索更多 AI 应用</h2><div className="coming-grid">{[{ name: '语音识别', text: '观察声音如何变成文字', icon: <AudioOutlined /> },{ name: '语音交互', text: '用声音与虚拟角色互动', icon: <MessageOutlined /> },{ name: '翻译体验', text: '探索语言与上下文的关系', icon: <TranslationOutlined /> }].map(item => <article className="coming-card" key={item.name}><span className="coming-icon" aria-hidden="true">{item.icon}</span><div><h3>{item.name}</h3><p>{item.text}</p></div><Tag>规划中</Tag></article>)}</div></section>
    <ContextAssistant mode="navigation" context="当前可进入图像分类体验与图像分类训练；语音和翻译尚未开放。这里只读取应用介绍，不读取训练项目。" onExperience={onExperience} onTraining={onTraining}/>
  </div>;
}
