import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Alert, Button, Drawer, Input } from 'antd';
import { ArrowUpOutlined, BulbOutlined, CloseOutlined, CommentOutlined, DeleteOutlined } from '@ant-design/icons';

interface Props {
  open: boolean; onClose: () => void; title: string; subtitle: string;
  context: ReactNode; children: ReactNode;
  welcomeTitle: string; welcomeText: string; capabilities: string[];
  prompts: { label: string; onClick: () => void }[];
  draft: string; onDraftChange: (value: string) => void; onSend: () => void;
  inputLabel: string; placeholder: string; messageCount: number;
  storageError: string | null; confirmClear: boolean;
  onRequestClear: () => void; onCancelClear: () => void; onClear: () => void;
  localNote: string;
}
export default function AssistantShell(props: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const send = () => { props.onSend(); inputRef.current?.focus(); };
  useEffect(() => { if (props.open) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [props.messageCount, props.open]);
  return <Drawer open={props.open} onClose={props.onClose} placement="right" width="min(440px, 100vw)" mask={false}
    rootClassName="experiment-assistant" closeIcon={<CloseOutlined aria-hidden="true" />}
    title={<div className="assistant-title"><span className="assistant-symbol"><CommentOutlined aria-hidden="true" /></span><div><b>{props.title}</b><small>{props.subtitle}</small></div></div>}
    extra={<Button type="text" size="small" aria-label="清空辅导记录" disabled={!props.messageCount} onClick={props.onRequestClear} icon={<DeleteOutlined aria-hidden="true" />} />}
    styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }, header: { padding: '20px 16px' } }}>
    <div className="assistant-mode"><span className="assistant-mode-dot" />助手演示 · 尚未接入 AI<span>预设回复</span></div>
    {props.confirmClear && <div className="assistant-clear-confirm" role="alert"><span>清空此助手的辅导记录？</span><Button size="small" onClick={props.onCancelClear}>保留</Button><Button size="small" danger onClick={props.onClear}>清空</Button></div>}
    {props.context}
    {props.storageError && <Alert className="assistant-storage-error" type="warning" showIcon message={props.storageError} />}
    <div className="assistant-conversation" role="log" aria-label="实验辅导对话" aria-live="polite" aria-relevant="additions">
      <div className="assistant-welcome"><span className="assistant-welcome-icon"><BulbOutlined aria-hidden="true" /></span><h3>{props.welcomeTitle}</h3><p>{props.welcomeText}</p><div className="assistant-capabilities">{props.capabilities.map(item => <span key={item}>{item}</span>)}</div></div>
      {props.children}<div ref={endRef} />
    </div>
    <div className="assistant-composer"><div className="assistant-prompts">{props.prompts.map(item => <Button key={item.label} size="small" onClick={item.onClick}>{item.label}</Button>)}</div>
      <div className="assistant-input-box"><Input.TextArea ref={inputRef} aria-label={props.inputLabel} placeholder={props.placeholder} value={props.draft} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} variant="borderless"
        onChange={event => props.onDraftChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <div className="assistant-input-bottom"><span>{props.draft.length}/1000 · Shift+Enter 换行</span><Button type="primary" shape="circle" aria-label="发送问题" disabled={!props.draft.trim()} icon={<ArrowUpOutlined aria-hidden="true" />} onClick={send} /></div>
      </div><p className="assistant-local-note">{props.localNote}</p>
    </div>
  </Drawer>;
}
