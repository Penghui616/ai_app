import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Switch } from 'antd';
import { CameraOutlined, PauseCircleOutlined, VideoCameraOutlined } from '@ant-design/icons';

interface Props {
  disabled?: boolean;
  inferenceEnabled?: boolean;
  onFrame?: (dataUrl: string, isCurrent: () => boolean, signal: AbortSignal) => Promise<void>;
  mode?: 'demo'|'real';
  onCapture?: (file: File) => Promise<void>;
  captureLabel?: string;
  continuous?: boolean;
}
const explainError = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return '摄像头权限未开启，请在浏览器的站点设置中允许访问，然后重试。';
  if (name === 'NotFoundError') return '没有找到摄像头。请连接设备，或切换为上传图片。';
  if (name === 'NotReadableError') return '摄像头可能被其他程序占用，请关闭占用程序后重试。';
  if (name === 'OverconstrainedError') return '所选摄像头不可用，请选择其他设备。';
  return error instanceof Error ? error.message : '摄像头无法启动，请检查设备后重试。';
};

export default function CameraPanel({ disabled = false, inferenceEnabled = true, onFrame, onCapture,
  captureLabel = '拍摄一张', continuous = false, mode = 'demo' }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const captureBusy = useRef(false);
  const handlers = useRef({ onFrame, onCapture });
  handlers.current = { onFrame, onCapture };
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [live, setLive] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [frames, setFrames] = useState(0);

  const release = () => {
    generation.current++;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  const stop = () => { release(); setActive(false); setOpening(false); setCollecting(false); };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) stop(); };
    const pageHide = () => stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pageHide);
    return () => {
      mounted.current = false; release();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pageHide);
    };
  }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);

  const refreshDevices = async () => {
    try {
      const found = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current) setDevices(found.filter(item => item.kind === 'videoinput'));
    } catch { /* Device names are optional; a permitted default camera still works. */ }
  };
  useEffect(() => {
    const media = navigator.mediaDevices;
    const changed = () => { void refreshDevices(); };
    media?.addEventListener('devicechange', changed);
    return () => media?.removeEventListener('devicechange', changed);
  }, []);

  const start = async (requestedId = deviceId) => {
    stop(); setError(''); setOpening(true); setFrames(0);
    const token = generation.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器无法访问摄像头。请使用 HTTPS 或本机 localhost 地址打开。');
      }
      const incoming = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, ...(requestedId ? { deviceId: { exact: requestedId } } : { facingMode: 'user' }) } });
      if (!mounted.current || token !== generation.current) { incoming.getTracks().forEach(track => track.stop()); return; }
      stream.current = incoming;
      incoming.getVideoTracks().forEach(track => { track.onended = () => { stop(); setError('摄像头连接已断开，请检查设备并重新开启。'); }; });
      if (!video.current) { release(); return; }
      video.current.srcObject = incoming;
      await video.current.play();
      if (!mounted.current || token !== generation.current) return;
      setDeviceId(incoming.getVideoTracks()[0]?.getSettings().deviceId || requestedId);
      setActive(true);
      void refreshDevices();
    } catch (reason) {
      if (mounted.current && token === generation.current) { release(); setError(explainError(reason)); setActive(false); setOpening(false); }
    } finally { if (mounted.current && token === generation.current) setOpening(false); }
  };
  const canvasFrame = () => {
    const source = video.current;
    if (!source || source.readyState < 2 || !source.videoWidth) return null;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / source.videoWidth);
    canvas.width = Math.round(source.videoWidth * scale); canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法读取摄像头画面。');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  const capture = async () => {
    if (captureBusy.current || !stream.current || disabled) return;
    captureBusy.current = true; setCapturing(true);
    const token = generation.current;
    try {
      const canvas = canvasFrame();
      if (!canvas) return;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!blob) throw new Error('拍摄失败，请重试。');
      if (token !== generation.current || !mounted.current) return;
      await handlers.current.onCapture?.(new File([blob], `摄像头-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch (reason) {
      if (mounted.current && token === generation.current) { setError(explainError(reason)); setCollecting(false); }
    } finally { captureBusy.current = false; if (mounted.current) setCapturing(false); }
  };
  useEffect(() => {
    if (!active || !live || !inferenceEnabled || !onFrame) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const token = generation.current;
    const isCurrent = () => !cancelled && mounted.current && token === generation.current;
    const tick = async () => {
      try {
        const canvas = canvasFrame();
        if (canvas && isCurrent()) {
          await handlers.current.onFrame?.(canvas.toDataURL('image/jpeg', .8), isCurrent, controller.signal);
          if (isCurrent()) setFrames(count => count + 1);
        }
      } catch (reason) { if (isCurrent()) { setError(explainError(reason)); setLive(false); } }
      if (isCurrent()) timer = setTimeout(() => void tick(), 500);
    };
    void tick();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [active, live, inferenceEnabled, !!onFrame]);
  useEffect(() => {
    if (!active || !collecting || disabled) return;
    const timer = setInterval(() => void capture(), 700);
    return () => clearInterval(timer);
  }, [active, collecting, disabled]);

  return <div className="camera-panel">
    <div className="camera-device-row"><span><i className={active ? 'camera-dot active' : 'camera-dot'}/>{active ? '摄像头已开启' : '摄像头未开启'}</span>
      {devices.length > 0 && <Select aria-label="选择摄像头" value={deviceId || undefined} disabled={opening || disabled}
        options={devices.map((device, index) => ({ value: device.deviceId, label: device.label || `摄像头 ${index + 1}` }))}
        onChange={value => { setDeviceId(value); if (active) void start(value); }}/>}</div>
    <div className={'camera-preview ' + (active ? 'is-active' : '')}>
      <video ref={video} muted playsInline aria-label="摄像头实时画面" />
      {!active && <div className="camera-placeholder"><VideoCameraOutlined aria-hidden="true"/><b>{opening ? '正在连接摄像头…' : '让物体出现在镜头里'}</b><span>开启后可查看实时画面，也可以使用图片文件</span></div>}
      {active && <span className="camera-preview-badge">实时画面</span>}
    </div>
    {error && <Alert type="warning" showIcon message={error} className="camera-error"/>}
    <div className="camera-actions">
      <Button onClick={() => active || opening ? stop() : void start()} disabled={disabled} icon={active ? <PauseCircleOutlined aria-hidden="true"/> : <VideoCameraOutlined aria-hidden="true"/>}>{active ? '关闭摄像头' : opening ? '取消开启' : '开启摄像头'}</Button>
      {onCapture && <Button type="primary" icon={<CameraOutlined aria-hidden="true"/>} disabled={!active || disabled || collecting} loading={capturing && !collecting} onClick={() => void capture()}>{captureLabel}</Button>}
      {continuous && <Button type={collecting ? 'primary' : 'default'} danger={collecting} disabled={!active || disabled} onClick={() => setCollecting(value => !value)}>{collecting ? '停止采集' : '连续采集'}</Button>}
    </div>
    {onFrame && <div className="camera-live-row"><label><Switch aria-label={mode==='real'?'实时识别':'实时演示'} checked={live && active && inferenceEnabled} disabled={!active || !inferenceEnabled} onChange={value => { setError(''); setLive(value); }}/><span>{!inferenceEnabled ? (mode==='real'?'等待识别服务就绪':'完成演示训练后可实时校验') : live && active ? (mode==='real'?'实时识别中':'实时演示中') : (mode==='real'?'实时识别已暂停':'实时演示已暂停')}</span></label><small aria-live="off">已处理 {frames} 帧</small></div>}
    <p className="camera-privacy">{mode==='real'?(onFrame?'开启实时识别后，画面会发送到本应用后端推理，不自动保存。':'点击拍摄或连续采集后，样本会上传并保存在后端；关闭摄像头后停止采集。'):<>{continuous ? '连续采集约每 0.7 秒一张，相同画面会去重。' : '画面仅在本机处理；关闭摄像头后停止取帧。'}{onFrame ? ' 当前输出为模拟分数。' : ' 拍摄样本保存在当前浏览器。'}</>}</p>
  </div>;
}
