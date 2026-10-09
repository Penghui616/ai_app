import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRightOutlined, AudioOutlined, CameraOutlined, ExperimentOutlined, MessageOutlined, TranslationOutlined } from '@ant-design/icons';
import ContextAssistant from './ContextAssistant';
interface Props { onExperience: () => void; onTraining: () => void }
interface TileProps { name: string; description: string; code: string; icon: ReactNode; onOpen?: () => void }
function ApplicationTile({ name, description, code, icon, onOpen }: TileProps) {
  return <button className={'catalog-tile' + (!onOpen ? ' unavailable' : '')} disabled={!onOpen} onClick={onOpen} aria-label={onOpen ? '打开' + name : name + '，开发中'}>
    <span className="catalog-tile-title">{name}{onOpen && <ArrowRightOutlined aria-hidden="true" />}</span>
    <span className="catalog-tile-description">{description}</span>
    <span className="catalog-tile-status">{onOpen ? (name==='图像分类体验'?'真实模型 · 36 类果蔬':'前端演示') : '开发中'}</span>
    <span className="catalog-tile-code" aria-hidden="true">{code}</span>
    <span className="catalog-tile-icon" aria-hidden="true">{icon}</span>
  </button>;
}
export default function ApplicationHub({ onExperience, onTraining }: Props) {
  const experienceRef = useRef<HTMLElement>(null);
  const experimentRef = useRef<HTMLElement>(null);
  const [section, setSection] = useState<'experience' | 'experiment'>('experience');
  const selectSection = (next: 'experience' | 'experiment') => {
    setSection(next);
    (next === 'experience' ? experienceRef : experimentRef).current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  return <div className="catalog-layout">
    <aside className="catalog-sidebar"><div className="catalog-sidebar-label">应用分类</div><nav aria-label="应用分类">
      <button className={section === 'experience' ? 'selected' : ''} aria-pressed={section === 'experience'} onClick={() => selectSection('experience')}><CameraOutlined aria-hidden="true" />应用体验</button>
      <button className={section === 'experiment' ? 'selected' : ''} aria-pressed={section === 'experiment'} onClick={() => selectSection('experiment')}><ExperimentOutlined aria-hidden="true" />应用实验</button>
    </nav></aside>
    <div className="catalog-content"><header className="catalog-heading"><h1>应用选择</h1><p>选择一个应用，开始体验或实验。</p></header>
      <section className="catalog-section" ref={experienceRef} aria-labelledby="experience-category"><h2 id="experience-category"><CameraOutlined aria-hidden="true" />应用体验<span>使用已有应用，观察 AI 的表现</span></h2><div className="catalog-grid">
        <ApplicationTile name="图像分类体验" description="摄像头或上传图片，体验果蔬识别" code="A1" icon={<CameraOutlined />} onOpen={onExperience}/>
        <ApplicationTile name="语音识别体验" description="录制声音，体验语音转文字" code="A2" icon={<AudioOutlined />}/>
        <ApplicationTile name="翻译体验" description="输入文字，体验不同语言的转换" code="A3" icon={<TranslationOutlined />}/>
      </div></section>
      <section className="catalog-section" ref={experimentRef} aria-labelledby="experiment-category"><h2 id="experiment-category"><ExperimentOutlined aria-hidden="true" />应用实验<span>动手构建应用，测试与改进</span></h2><div className="catalog-grid">
        <ApplicationTile name="图像分类实验" description="准备数据、训练模型并测试效果" code="B1" icon={<ExperimentOutlined />} onOpen={onTraining}/>
        <ApplicationTile name="语音交互实验" description="配置语音指令，探索交互过程" code="B2" icon={<MessageOutlined />}/>
        <ApplicationTile name="翻译应用实验" description="构建翻译应用，比较与分析结果" code="B3" icon={<TranslationOutlined />}/>
      </div></section>
      <p className="catalog-demo-note">图像分类体验已接入果蔬模型，需后端服务运行。分类实验仍为模拟训练，助手使用预设回复。</p>
    </div>
    <ContextAssistant mode="navigation" context="应用分为应用体验和应用实验。当前可进入图像分类体验与图像分类实验；语音和翻译尚未开放。这里只读取应用介绍，不读取训练项目。" onExperience={onExperience} onTraining={onTraining}/>
  </div>;
}
