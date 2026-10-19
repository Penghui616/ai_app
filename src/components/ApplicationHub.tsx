import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRightOutlined, AudioOutlined, CameraOutlined, ExperimentOutlined, MessageOutlined, SoundOutlined, TranslationOutlined } from '@ant-design/icons';
import { isRealTraining } from '../services/api';
import ContextAssistant from './ContextAssistant';
interface Props { onExperience: () => void; onTraining: () => void; onSpeech: () => void; onSynthesis: () => void }
interface TileProps { name: string; description: string; code: string; icon: ReactNode; onOpen?: () => void; status?: string }
function ApplicationTile({ name, description, code, icon, onOpen, status }: TileProps) {
  return <button className={'catalog-tile' + (!onOpen ? ' unavailable' : '')} disabled={!onOpen} onClick={onOpen} aria-label={onOpen ? '打开' + name : name + '，开发中'}>
    <span className="catalog-tile-title">{name}{onOpen && <ArrowRightOutlined aria-hidden="true" />}</span>
    <span className="catalog-tile-description">{description}</span>
    <span className="catalog-tile-status">{onOpen ? status : '开发中'}</span>
    <span className="catalog-tile-code" aria-hidden="true">{code}</span>
    <span className="catalog-tile-icon" aria-hidden="true">{icon}</span>
  </button>;
}
export default function ApplicationHub({ onExperience, onTraining, onSpeech, onSynthesis }: Props) {
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
        <ApplicationTile name="图像分类体验" description="拍摄或上传图片，看看 AI 认识哪些果蔬" code="A1" icon={<CameraOutlined />} onOpen={onExperience} status="36 类果蔬识别"/>
        <ApplicationTile name="语音识别体验" description="录下一段话，或上传音频，观察识别结果" code="A2" icon={<AudioOutlined />} onOpen={onSpeech} status="声音转文字"/>
        <ApplicationTile name="语音合成体验" description="输入一段文字，选择声音，试听并下载" code="A3" icon={<SoundOutlined />} onOpen={onSynthesis} status="6 种音色 · 文字转语音"/>
        <ApplicationTile name="翻译体验" description="输入文字，体验不同语言的转换" code="A4" icon={<TranslationOutlined />}/>
      </div></section>
      <section className="catalog-section" ref={experimentRef} aria-labelledby="experiment-category"><h2 id="experiment-category"><ExperimentOutlined aria-hidden="true" />应用实验<span>动手构建应用，测试与改进</span></h2><div className="catalog-grid">
        <ApplicationTile name="图像分类实验" description="采集样本、训练模型，用新图片检验效果" code="B1" icon={<ExperimentOutlined />} onOpen={onTraining} status={isRealTraining ? '自定义分类训练' : '训练流程演示'}/>
        <ApplicationTile name="语音交互实验" description="配置语音指令，探索交互过程" code="B2" icon={<MessageOutlined />}/>
        <ApplicationTile name="翻译应用实验" description="构建翻译应用，比较与分析结果" code="B3" icon={<TranslationOutlined />}/>
      </div></section>
      <p className="catalog-demo-note">先体验 AI 能做什么，再通过实验探索它如何学习。</p>
    </div>
    <ContextAssistant mode="navigation" context="应用分为应用体验和应用实验。当前可进入图像分类体验、图像分类实验、语音识别体验及语音合成体验。语音识别支持录音、上传、试听及百炼转写，需后端服务；语音合成支持文字、音色与参数设置及百炼合成、试听、下载，需后端服务；翻译尚未开放。这里只读取应用介绍，不读取训练项目。" onExperience={onExperience} onTraining={onTraining}/>
  </div>;
}
