import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button } from 'antd';
import { ArrowLeftOutlined, AudioOutlined, BulbOutlined, ClockCircleOutlined, CopyOutlined, FileTextOutlined, ReloadOutlined, SoundOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { speechService } from '../services/speech';
import type { SpeechLanguage, SpeechResult, SpeechStatus } from '../services/speech';
import './SpeechExperience.css';

const MAX_SECONDS = 60;
const MAX_BYTES = 20 * 1024 * 1024;
const readings = [
  { id: 'free', name: '自由表达', text: '说说今天的天气，或介绍一个你喜欢的事物。' },
  { id: 'poem', name: '静夜思 · 唐 · 李白', text: '床前明月光，疑是地上霜。举头望明月，低头思故乡。' },
  { id: 'daily', name: '普通话 · 日常短句', text: '今天阳光很好，我想和同学一起去公园观察植物。' },
  { id: 'english', name: 'English · A sunny day', text: 'It is a sunny day. I would like to go to the park with my friends.' },
];
type Phase = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'reading';
interface Clip { blob: Blob; url: string; name: string; seconds: number }
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '未获得麦克风权限。请在浏览器地址栏允许使用麦克风后重试。';
  if (name === 'NotFoundError') return '没有找到麦克风，请连接设备后重试。';
  if (name === 'NotReadableError') return '无法使用麦克风，请检查设备是否被其他程序占用。';
  return '录音未能开始，请检查麦克风及浏览器支持情况后重试。';
}

export default function SpeechExperience({ onHome }: { onHome: () => void }) {
  const { message } = App.useApp();
  const [source, setSource] = useState<'record' | 'upload'>('record');
  const [language, setLanguage] = useState<SpeechLanguage>('zh');
  const [reading, setReading] = useState('poem');
  const [phase, setPhase] = useState<Phase>('idle');
  const [clip, setClip] = useState<Clip | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<SpeechStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const available = serviceStatus?.available === true;
  const fileInput = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatusLoading(true); setStatusError(''); setServiceStatus(null);
    speechService.status(controller.signal).then(value => { if (!controller.signal.aborted) setServiceStatus(value); })
      .catch(failure => { if (!controller.signal.aborted) setStatusError(failure instanceof Error ? failure.message : '无法读取语音服务状态。'); })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false); });
    return () => controller.abort();
  }, [statusAttempt]);

  function releaseCapture() {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
  function clearClip() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setClip(null);
  }
  function invalidate() {
    epoch.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    releaseCapture();
    clearClip();
    setPhase('idle'); setSeconds(0); setVolume(0);
    setError(''); setNotice(''); setResult(null); setRecognizing(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  useEffect(() => () => {
    epoch.current++;
    requestRef.current?.abort();
    releaseCapture();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  function acceptClip(blob: Blob, name: string, duration: number) {
    clearClip();
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setClip({ blob, name, seconds: duration, url });
  }
  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      setPhase('finalizing');
      releaseCapture();
      setVolume(0);
    }
  }
  async function startRecording() {
    invalidate();
    const token = epoch.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('当前环境无法使用麦克风，请使用 HTTPS 或本机 localhost 地址，也可以上传音频。'); return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用新版 Chrome 或 Edge，也可以上传音频。'); return;
    }
    setPhase('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== epoch.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let stoppedAfter = 0;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (token !== epoch.current) return;
        invalidate(); setError('录音中断，请检查麦克风后重新录制。');
      };
      recorder.onstop = () => {
        if (token !== epoch.current) return;
        stoppedAfter = (performance.now() - startedAt.current) / 1000;
        releaseCapture(); setVolume(0); setPhase('idle');
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size || stoppedAfter < 0.3) { setError('录音太短，请录制一段完整的话再试听。'); return; }
        if (blob.size > MAX_BYTES) { setError('录音文件超过 20 MB，请缩短录音后重试。'); return; }
        acceptClip(blob, '我的录音', Math.min(stoppedAfter, MAX_SECONDS));
      };
      let analyser: AnalyserNode | null = null;
      try {
        const context = new AudioContext(); contextRef.current = context;
        await context.resume();
        if (token !== epoch.current) return;
        analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
      } catch { /* The recording can still work without a volume meter. */ }
      if (token !== epoch.current) return;
      startedAt.current = performance.now();
      recorder.start(250); setPhase('recording');
      const samples = new Uint8Array(256);
      timerRef.current = setInterval(() => {
        if (token !== epoch.current) return;
        const elapsed = (performance.now() - startedAt.current) / 1000;
        setSeconds(Math.min(elapsed, MAX_SECONDS));
        if (analyser) {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / samples.length);
          setVolume(Math.min(100, Math.round(rms * 350)));
        }
        if (elapsed >= MAX_SECONDS) { setNotice('已达到 60 秒上限，录音已自动停止。'); stopRecording(); }
      }, 100);
    } catch (failure) {
      if (token !== epoch.current) return;
      releaseCapture(); setPhase('idle'); setError(microphoneError(failure));
    }
  }

  async function upload(file: File) {
    invalidate();
    const token = epoch.current;
    if (!/\.(wav|mp3|m4a|ogg|webm)$/i.test(file.name)) { setError('请选择 WAV、MP3、M4A、OGG 或 WebM 音频文件。'); return; }
    if (!file.size || file.size > MAX_BYTES) { setError('音频不能为空，且文件大小不能超过 20 MB。'); return; }
    setPhase('reading');
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (token !== epoch.current) return;
      if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_SECONDS) {
        setError('请选择时长不超过 60 秒的有效音频，可先截取需要体验的片段。'); return;
      }
      acceptClip(file, file.name, decoded.duration);
    } catch {
      if (token === epoch.current) setError('无法读取这段音频，文件可能损坏或浏览器不支持其编码。请尝试 WAV 或 MP3 文件。');
    } finally {
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      if (token === epoch.current) setPhase('idle');
    }
  }
  async function recognize() {
    if (!clip || phase !== 'idle' || recognizing || !available) return;
    const token = ++epoch.current;
    const controller = new AbortController(); requestRef.current = controller;
    setRecognizing(true); setResult(null); setError('');
    try {
      const response = await speechService.transcribe({ audio: clip.blob, language, durationSeconds: clip.seconds }, controller.signal);
      if (token === epoch.current) setResult(response);
    } catch (failure) {
      if (token === epoch.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '识别失败，请重试。');
    } finally { if (token === epoch.current) setRecognizing(false); }
  }
  const busy = phase !== 'idle';
  const material = readings.find(item => item.id === reading)!;
  return <div className="speech-page">
    <header className="speech-heading"><Button type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={onHome}>返回</Button></header>
    <div className="speech-intro"><div><span className="speech-eyebrow">声音探索 / 声音 → 文字</span><h1>语音识别</h1><p>让 AI 听一听，再看看它写下了什么。</p></div><div className="speech-intro-symbol" aria-hidden="true"><AudioOutlined /><span>→</span><span>Aa</span></div></div>
    <div className="speech-columns">
      <section className="speech-card" aria-labelledby="speech-input-title">
        <div className="speech-card-heading"><h2 id="speech-input-title"><span className="speech-section-number">01</span>准备声音</h2><select aria-label="识别语言" value={language} disabled={busy || recognizing} onChange={event => { setLanguage(event.target.value as SpeechLanguage); setResult(null); }}>
          <option value="zh">普通话</option><option value="en">English</option><option value="auto">自动识别</option>
        </select></div>
        <div className="speech-source" role="group" aria-label="语音输入方式">
          <Button icon={<AudioOutlined aria-hidden="true" />} className={source === 'record' ? 'selected' : ''} aria-pressed={source === 'record'} onClick={() => { if (source !== 'record') { invalidate(); setSource('record'); } }}>录音识别</Button>
          <Button icon={<UploadOutlined aria-hidden="true" />} className={source === 'upload' ? 'selected' : ''} aria-pressed={source === 'upload'} onClick={() => { if (source !== 'upload') { invalidate(); setSource('upload'); } }}>上传音频</Button>
        </div>
        <div className={'speech-input-stage ' + (phase === 'recording' ? 'is-recording' : '')}>
          <span className="speech-timer"><ClockCircleOutlined aria-hidden="true" /> {formatTime(clip?.seconds ?? seconds)} / 01:00</span>
          {clip ? <div className="speech-audio"><strong title={clip.name}>{clip.name}</strong><audio key={clip.url} src={clip.url} controls preload="metadata" aria-label="试听音频" onError={() => setError('浏览器无法播放此音频，请重新录制或更换文件格式。')} /><small>{clip.seconds.toFixed(1)} 秒 · {(clip.blob.size / 1024).toFixed(0)} KB · 可先试听再识别</small></div> : <>
            {source === 'record' ? <AudioOutlined aria-hidden="true" className="speech-stage-icon" /> : <UploadOutlined aria-hidden="true" className="speech-stage-icon" />}
            <span role="status">{phase === 'recording' ? '正在录音，请说话…' : phase === 'requesting' ? '请允许浏览器使用麦克风' : phase === 'finalizing' ? '正在整理录音…' : phase === 'reading' ? '正在检查音频…' : source === 'record' ? '点击下方按钮开始录音' : '选择一段音频，体验声音转文字'}</span>
            {phase === 'recording' && <div className="speech-volume" role="meter" aria-label="麦克风音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={volume}><span style={{ width: `${volume}%` }} /></div>}
          </>}
        </div>
        {source === 'record' ? <>
          <div className="speech-reading-block"><div className="speech-reading-heading"><span>不知道说什么？</span><select className="speech-reading" aria-label="朗读材料" value={reading} onChange={event => setReading(event.target.value)} disabled={busy || recognizing}>{readings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="speech-reference">{material.text}</div></div>
          {phase === 'recording' ? <Button type="primary" danger block icon={<StopOutlined aria-hidden="true" />} onClick={stopRecording}>停止录音</Button> : <Button type="primary" block icon={<AudioOutlined aria-hidden="true" />} loading={phase === 'requesting' || phase === 'finalizing'} disabled={busy || recognizing} onClick={() => void startRecording()}>{clip ? '重新录音' : '开始录音'}</Button>}
        </> : <>
          <input ref={fileInput} type="file" accept=".wav,.mp3,.m4a,.ogg,.webm" aria-label="选择音频文件" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
          <p className="speech-file-hint">支持 WAV、MP3、M4A、OGG、WebM<br/>单段不超过 60 秒，文件不超过 20 MB</p>
          <Button type="primary" block icon={<UploadOutlined aria-hidden="true" />} loading={phase === 'reading'} disabled={busy || recognizing} onClick={() => fileInput.current?.click()}>{clip ? '更换音频' : '选择音频文件'}</Button>
        </>}
        <Button className="speech-recognize" block type="primary" icon={<FileTextOutlined aria-hidden="true" />} disabled={!clip || busy || !available || statusLoading} loading={recognizing} onClick={() => void recognize()}>开始识别</Button>
        {error && <Alert type="error" showIcon message={error} />}
        {notice && <Alert type="info" showIcon message={notice} />}
        {(statusLoading || !available) && <Alert type="info" showIcon message={statusLoading ? '正在检查语音识别服务…' : statusError || serviceStatus?.message || '语音服务暂不可用。'} action={<Button size="small" loading={statusLoading} disabled={recognizing} onClick={() => setStatusAttempt(value => value + 1)}>重新检查</Button>} />}
        <div className="speech-service-note"><SoundOutlined aria-hidden="true" /><span>点击“开始识别”后，音频将发送至阿里云百炼进行转写。平台不保存音频历史，参考文字不会作为识别答案；请勿录入个人敏感信息。</span></div>
      </section>
      <section className="speech-card speech-output-card" aria-labelledby="speech-result-title">
        <div className="speech-card-heading"><h2 id="speech-result-title"><span className="speech-section-number">02</span>识别结果</h2>{result && <Button type="text" icon={<CopyOutlined aria-hidden="true" />} onClick={() => void navigator.clipboard.writeText(result.text).then(() => message.success('已复制识别文字')).catch(() => message.error('复制失败，请手动选择文字复制。'))}>复制</Button>}</div>
        <p className="speech-result-caption">对照你说的话，观察有没有漏字或同音字。</p>
        <div className="speech-result" aria-live="polite">{result ? <><p>{result.text || result.notice || '未识别到文字，请检查录音内容。'}</p><small>音频 {result.durationSeconds.toFixed(1)} 秒 · 处理耗时 {(result.elapsedMs / 1000).toFixed(2)} 秒</small></> : <div className="speech-empty"><SoundOutlined aria-hidden="true" /><span>{recognizing ? '正在识别，请稍候…' : '识别结果将显示在这里'}</span></div>}</div>
        <div className="speech-output-actions"><Button icon={<ReloadOutlined aria-hidden="true" />} disabled={!result || recognizing} onClick={() => setResult(null)}>清空结果</Button><Button onClick={() => { invalidate(); setSource('record'); setLanguage('zh'); setReading('poem'); }}>重置全部</Button></div>
      </section>
    </div>
    <aside className="speech-knowledge"><span className="speech-bulb"><BulbOutlined aria-hidden="true" /></span><div><h2>再试一次，会有什么不同？</h2><p>用同一句话，试着放慢语速、改变距离或换一个安静的环境，再比较识别文字。语音识别将声音转成文字；识别正确不等于发音标准。</p></div></aside>
  </div>;
}
