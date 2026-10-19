import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { ArrowLeftOutlined, BookOutlined, DownloadOutlined, PlayCircleOutlined, ReloadOutlined, SoundOutlined } from '@ant-design/icons';
import './SpeechSynthesisExperience.css';
import { ttsService } from '../services/tts';
import type { TtsInput, TtsStatus } from '../services/tts';

const LIMIT = 100;
const library = [
  { id: 'poem', title: '古诗词', items: [
    { title: '静夜思', detail: '唐 · 李白', text: '床前明月光，疑是地上霜。举头望明月，低头思故乡。' },
    { title: '春晓', detail: '唐 · 孟浩然', text: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。' },
    { title: '咏鹅', detail: '唐 · 骆宾王', text: '鹅，鹅，鹅，曲项向天歌。白毛浮绿水，红掌拨清波。' },
  ] },
  { id: 'english', title: '英语角', items: [
    { title: 'Hello, AI!', detail: '认识新朋友', text: 'Hello! I am your AI friend. What would you like to learn today?' },
    { title: 'A sunny day', detail: '描述天气', text: 'The sun is shining. Let us go outside and find something wonderful!' },
    { title: 'My little garden', detail: '观察自然', text: 'This is my little garden. I water the flowers and watch them grow every day.' },
  ] },
  { id: 'story', title: '小故事', items: [
    { title: '发光的种子', detail: '森林里的发现', text: '小兔子捡到一颗发光的种子，把它种在窗前。第二天，一朵小花探出头来：“谢谢你，让我看见了太阳！”' },
    { title: '月亮邮递员', detail: '一封晚安信', text: '小熊把一封信交给风，请它送到月亮上。晚上，窗前落下一束月光，信上只有两个字：晚安。' },
    { title: '会问问题的机器人', detail: '一次好奇的探索', text: '机器人第一次走进花园，问：“花为什么会开？”女孩笑着说：“我们一起观察吧！”它们记下每天的变化，终于找到了线索。' },
  ] },
  { id: 'tongue', title: '趣味绕口令', items: [
    { title: '四和十', detail: '试试平翘舌', text: '四是四，十是十，十四是十四，四十是四十。要想说对四和十，多多练习十和四。' },
    { title: '吃葡萄', detail: '听清每个字', text: '吃葡萄不吐葡萄皮，不吃葡萄倒吐葡萄皮。' },
    { title: '小花鼓', detail: '感受节奏', text: '一面小花鼓，鼓上画老虎。宝宝敲破鼓，妈妈拿布补。不知是布补鼓，还是布补虎。' },
  ] },
];
const DEFAULT_TEXT = library[0].items[0].text;
interface RangeProps { id: string; label: string; value: number; min: number; max: number; step: number; display: string; low: string; high: string; onChange: (value: number) => void }
function VoiceRange({ id, label, value, min, max, step, display, low, high, onChange }: RangeProps) {
  return <div className="tts-setting">
    <div className="tts-setting-title"><label htmlFor={id}>{label}</label><output htmlFor={id}>{display}</output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={display} onChange={event => onChange(Number(event.target.value))} />
    <div className="tts-range-hints"><span>{low}</span><span>{high}</span></div>
  </div>;
}

export default function SpeechSynthesisExperience({ onHome }: { onHome: () => void }) {
  const [category, setCategory] = useState('poem');
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voice, setVoice] = useState('Cherry');
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(75);
  const [service, setService] = useState<TtsStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ url: string; key: string; input: TtsInput } | null>(null);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const urlRef = useRef<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const input: TtsInput = { text: text.trim(), voice, speed, pitch, volume };
  const inputKey = JSON.stringify(input);
  const stale = !!result && result.key !== inputKey;
  useEffect(() => {
    const controller = new AbortController();
    setService(null); setStatusError('');
    ttsService.status(controller.signal).then(value => { if (!controller.signal.aborted) setService(value); })
      .catch(failure => { if (!controller.signal.aborted) setStatusError(failure instanceof Error ? failure.message : '无法查询合成服务。'); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => { if (stale) player.current?.pause(); }, [stale]);
  useEffect(() => () => {
    revision.current++; request.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  function cancel() {
    revision.current++; request.current?.abort(); request.current = null; setBusy(false);
    setNotice('已停止等待；已提交的合成可能继续并产生费用，请稍后再试。');
  }
  async function synthesize() {
    if (!input.text || busy || request.current || !service?.available) return;
    const controller = new AbortController(); request.current = controller;
    const token = ++revision.current;
    setBusy(true); setError(''); setNotice(''); player.current?.pause();
    try {
      const audio = await ttsService.synthesize(input, controller.signal);
      if (token !== revision.current) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(audio); urlRef.current = url;
      setResult({ url, key: inputKey, input });
    } catch (failure) {
      if (token === revision.current) setError(failure instanceof Error ? failure.message : '合成失败，请重试。');
    } finally {
      if (token === revision.current) { setBusy(false); request.current = null; }
    }
  }
  function download() {
    if (!result || stale || busy) return;
    const link = document.createElement('a'); link.href = result.url;
    link.download = `speech-${result.input.voice}.wav`; link.click();
  }
  const count = Array.from(text).length;
  const collection = library.find(item => item.id === category)!;
  function reset() {
    cancel(); player.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null; setResult(null); setError(''); setNotice('');
    setCategory('poem'); setText(DEFAULT_TEXT); setVoice('Cherry'); setSpeed(1); setPitch(1); setVolume(75);
  }
  return <div className="tts-page">
    <header className="tts-heading"><Button type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={onHome}>返回</Button><Button type="text" icon={<ReloadOutlined aria-hidden="true" />} onClick={reset}>重置全部</Button></header>
    <div className="tts-intro"><div><span className="tts-eyebrow">声音探索 / 文字 → 声音</span><h1>语音合成体验</h1><p>为一段文字，找到它的声音。</p></div><div className="tts-intro-symbol" aria-hidden="true"><span>Aa</span><span>→</span><SoundOutlined aria-hidden="true" /></div></div>
    <section className="tts-library" aria-labelledby="tts-library-title">
      <div className="tts-library-heading"><h2 id="tts-library-title"><BookOutlined aria-hidden="true" /> 选一段素材</h2><span>也可以在下方自由创作</span></div>
      <div className="tts-categories" role="group" aria-label="素材分类">{library.map(group => <button key={group.id} aria-pressed={category === group.id} aria-controls="tts-materials" onClick={() => setCategory(group.id)}>{group.title}</button>)}</div>
      <div id="tts-materials" className="tts-materials" role="group" aria-label={`${collection.title}篇目`}>{collection.items.map(item => <button key={item.title} className="tts-material" disabled={busy} aria-pressed={text === item.text} onClick={() => setText(item.text)}><span><strong>{item.title}</strong><small>{item.detail}</small></span><span className="tts-material-action">{text === item.text ? '已选用' : '选用'} <span aria-hidden="true">↗</span></span></button>)}</div>
    </section>
    <fieldset className="tts-workbench" disabled={busy}>
      <section className="tts-editor" aria-labelledby="tts-text-heading">
        <div className="tts-section-heading"><h2 id="tts-text-heading"><span>01</span><label htmlFor="tts-text">输入文字</label></h2><span id="tts-count" className="tts-count">{count}/{LIMIT} 字</span></div>
        <textarea id="tts-text" placeholder="写一段你想听见的文字…" value={text} aria-describedby="tts-count tts-text-hint" onChange={event => setText(Array.from(event.target.value).slice(0, LIMIT).join(''))} />
        <div className="tts-editor-footer"><span id="tts-text-hint">{count >= LIMIT ? '已达到 100 字上限，可删减后继续编辑。' : '逗号与句号，也会改变朗读的节奏。'}</span><Button type="text" size="small" disabled={!text} onClick={() => setText('')}>清空文字</Button></div>
      </section>
      <section className="tts-controls" aria-labelledby="tts-controls-heading">
        <div className="tts-section-heading"><h2 id="tts-controls-heading"><span>02</span>设定声音</h2></div>
        <div className="tts-voice"><label htmlFor="tts-voice">选择音色</label><select id="tts-voice" value={voice} onChange={event => setVoice(event.target.value)}>
          <option value="Cherry">明亮女声 · 芊悦</option>
          <option value="Serena">温柔女声 · 苏瑶</option>
          <option value="Ethan">活力男声 · 晨煦</option>
          <option value="Neil">新闻播报男声 · 阿闻</option>
          <option value="Jennifer">美式英语女声 · 詹妮弗</option>
          <option value="Aiden">美式英语男声 · 艾登</option>
        </select></div>
        <VoiceRange id="tts-speed" label="语速" value={speed} min={.5} max={2} step={.1} display={`${speed.toFixed(1)}x`} low="慢" high="快" onChange={setSpeed} />
        <VoiceRange id="tts-pitch" label="音调" value={pitch} min={.5} max={2} step={.1} display={pitch.toFixed(1)} low="低" high="高" onChange={setPitch} />
        <VoiceRange id="tts-volume" label="音量" value={volume} min={0} max={100} step={1} display={`${volume}%`} low="轻" high="响" onChange={setVolume} />
      </section>
    </fieldset>
    <section className="tts-player" aria-label="合成语音播放区">
      <div className="tts-player-title"><span className="tts-player-icon" aria-hidden="true"><SoundOutlined aria-hidden="true" /></span><div><h2>试听你的作品</h2><p role="status">{busy ? '正在合成，请稍候…' : stale ? '文字或声音设置已改变，请重新合成。' : result ? '音频已生成，可以试听或下载。' : '等待生成音频'}</p></div></div>
      <div className="tts-player-actions"><Button disabled={!result || stale || busy} icon={<PlayCircleOutlined aria-hidden="true" />} aria-label="播放语音" onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => setError('播放失败，请尝试播放器按钮或下载音频。')); } }}>试听</Button><Button disabled={!result || stale || busy} icon={<DownloadOutlined aria-hidden="true" />} aria-label="下载音频" onClick={download}>下载</Button><Button type="primary" icon={<SoundOutlined aria-hidden="true" />} aria-label="合成语音" loading={busy} disabled={!input.text || !service?.available || busy} onClick={() => void synthesize()}>合成语音</Button>{busy && <Button onClick={cancel}>取消等待</Button>}</div>
      {result && !stale && <audio className="tts-audio" ref={player} key={result.url} src={result.url} controls={!busy} preload="metadata" aria-label="合成音频" onError={() => setError('音频无法播放，请重新合成或下载后播放。')} />}
      {result && !stale && <p className="tts-generated-settings">本次合成：语速 {result.input.speed.toFixed(1)}x · 音调 {result.input.pitch.toFixed(1)} · 音量 {result.input.volume}%{result.input.volume === 0 ? '（静音）' : ''}</p>}
      {error && <Alert className="tts-alert" type="error" showIcon message={error} />}
      {notice && <Alert className="tts-alert" type="info" showIcon message={notice} />}
      {!service?.available && <Alert className="tts-alert" type="info" showIcon message={statusError || service?.message || '正在检查语音合成服务…'} action={<Button size="small" disabled={busy} onClick={() => setAttempt(value => value + 1)}>重新检查</Button>} />}
      <p id="tts-service-note">调整音色、语速、音调或音量后需重新合成。文字将发送至阿里云百炼；平台不保存合成历史，请勿输入个人敏感信息。</p>
    </section>
    <p className="tts-learning-note">探索一下：同一句话，放慢语速和提高音调，会带来怎样的听觉感受？</p>
  </div>;
}
