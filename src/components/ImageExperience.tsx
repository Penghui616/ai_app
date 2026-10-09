import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Image, Input, Segmented, Tag, Upload } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, BulbOutlined, CloudUploadOutlined, DeleteOutlined, PictureOutlined, PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import type { ImageSample } from '../types';
import { prepareImage } from '../services/images';
import { demonstrateClassification, exampleImage, loadExperiences, saveExperiences } from '../services/experience';
import type { ExperienceRecord } from '../services/experience';
import ContextAssistant from './ContextAssistant';
import CameraPanel from './CameraPanel';
interface Props { onHome: () => void; onTraining: () => void }
export default function ImageExperience({ onHome, onTraining }: Props) {
  const { message, modal } = App.useApp();
  const [records, setRecords] = useState<ExperienceRecord[]>([]);
  const [selected, setSelected] = useState<ImageSample | null>(null);
  const [current, setCurrent] = useState<ExperienceRecord | null>(null);
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [source, setSource] = useState<'camera'|'file'>('camera');
  const [liveRecord,setLiveRecord] = useState<ExperienceRecord|null>(null);
  const displayed = source==='camera' ? liveRecord : current;
  const pending = useRef(0);
  const recordsLoaded = useRef(false);
  useEffect(() => {
    let active = true;
    loadExperiences().then(value => { if (active) { setRecords(value); recordsLoaded.current = true; } }).catch(() => { if (active) setStorageError('体验记录读取失败，暂时无法保存新记录。请重新打开页面重试。'); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; pending.current++; };
  }, []);
  const setImage = (image: ImageSample | null) => { pending.current++; setSelected(image); setCurrent(null); setNote(''); setProcessing(false); };
  const upload = async (file: File) => {
    const token = ++pending.current; setProcessing(true);
    try { const image = await prepareImage(file); if (token === pending.current) { setSelected(image); setCurrent(null); setNote(''); } }
    catch (error) { if (token === pending.current) message.error(error instanceof Error ? error.message : '图片读取失败'); }
    finally { if (token === pending.current) setProcessing(false); }
  };
  const persist = async (next: ExperienceRecord[]) => {
    if (!recordsLoaded.current) { setStorageError('原有记录未读取成功，已暂停保存以避免覆盖。请重新打开页面重试。'); return false; }
    setSaving(true);
    try { await saveExperiences(next); setRecords(next); setStorageError(''); return true; }
    catch { setStorageError('体验记录未保存，浏览器存储可能不足。当前图片仍可查看，请重试或导出已有记录。'); return false; }
    finally { setSaving(false); }
  };
  const demonstrate = async () => {
    if (!selected || processing || saving) return;
    const record = demonstrateClassification(selected); setCurrent(record); setNote('');
    await persist([record, ...records].slice(0,12));
  };
  const saveNote = async () => {
    if (!current) return;
    const updated = { ...current, note: note.trim() };
    const next = records.some(item => item.id === current.id) ? records.map(item => item.id === current.id ? updated : item) : [updated, ...records].slice(0,12);
    if (await persist(next)) { setCurrent(updated); message.success('观察记录已保存到本机。'); }
  };
  const remove = (record: ExperienceRecord) => modal.confirm({ title: '删除这条体验记录？', content: '仅删除这次体验，不影响分类训练项目。', okText: '删除记录', cancelText: '保留', onOk: async () => {
    if (!await persist(records.filter(item => item.id !== record.id))) throw new Error('保存失败');
    if (current?.id === record.id) setImage(null);
  } });
  const openRecord = (record: ExperienceRecord) => { setSource('file'); setLiveRecord(null); pending.current++; setSelected(record.image); setCurrent(record); setNote(record.note); setProcessing(false); window.scrollTo({ top: 0, behavior: 'auto' }); };
  const exportRecords = () => {
    const payload = { application: 'image-classification-experience', isMock: true, exportedAt: new Date().toISOString(), records: records.map(({ image, ...rest }) => ({ ...rest, imageName: image.name })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = '图像分类体验-演示记录.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  return <div className="image-experience">
    <Button className="back-apps" type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={onHome}>返回应用选择</Button>
    <div className="workspace-heading"><div><div className="eyebrow">应用探索 <span>/</span> 图像分类体验</div><h1>把物体放到镜头前，观察分类结果</h1><p>支持摄像头实时体验，也可以上传图片进行对比。</p></div><Tag color="cyan">体验模式 · 无需训练</Tag></div>
    <div className="demo-note"><BulbOutlined aria-hidden="true" /><span><b>前端演示</b> · 尚未连接识别模型。所有图片使用相同的示例分数，不代表真实识别结果。</span></div>
    {storageError && <Alert className="state-alert" type="warning" showIcon message={storageError} />}
    <section className="experience-model"><div className="experience-model-icon"><PictureOutlined aria-hidden="true" /></div><div><div className="model-name">水果分类 <Tag>界面示例</Tag></div><p>预设类别：苹果、香蕉、橙子。真实识别范围将在接入模型后确定。</p></div><div className="model-classes"><span>苹果</span><span>香蕉</span><span>橙子</span></div></section>
    <div className="experience-grid">
      <section><div className="section-heading"><span className="step-number">01</span><h2>图像输入</h2></div><Card className="experience-input-card">
        <div className="experience-source-heading"><b>输入来源</b><Segmented aria-label="体验输入来源" value={source} options={[{label:'摄像头',value:'camera'},{label:'文件',value:'file'}]} onChange={value=>{pending.current++;setProcessing(false);setSource(value as 'camera'|'file');setLiveRecord(null);}}/></div>
        {source==='camera'?<CameraPanel disabled={saving||!ready} captureLabel="定格并记录" onCapture={async file=>{const token=++pending.current;const image=await prepareImage(file);if(token!==pending.current)return;const record=demonstrateClassification(image);setSelected(image);setCurrent(record);setNote('');setSource('file');await persist([record,...records].slice(0,12));}} onFrame={async(dataUrl,isCurrent)=>{if(!isCurrent())return;setLiveRecord(demonstrateClassification({id:'live-preview',name:'摄像头实时画面',dataUrl,size:0,fingerprint:'live',createdAt:new Date().toISOString()}));}}/>:<>

        {selected ? <div className="experience-preview"><Image src={selected.dataUrl} alt={selected.name} /><div className="experience-image-label"><span>{selected.name}</span><Button type="text" size="small" aria-label="移除体验图片" disabled={saving} icon={<DeleteOutlined aria-hidden="true" />} onClick={() => setImage(null)} /></div></div> : <div data-testid="experience-upload"><Upload.Dragger accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={processing || saving || !ready} beforeUpload={file => { void upload(file); return Upload.LIST_IGNORE; }}><div className="experience-upload-icon"><CloudUploadOutlined aria-hidden="true" /></div><h3>把一张图片放到这里</h3><p>点击选择，或将图片拖入</p><span>JPG、PNG、WebP · 最大 5 MB</span></Upload.Dragger></div>}
        <div className="experience-input-actions">{selected && <Upload accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={processing || saving} beforeUpload={file => { void upload(file); return Upload.LIST_IGNORE; }}><Button disabled={saving} loading={processing} icon={<CloudUploadOutlined aria-hidden="true" />}>更换图片</Button></Upload>}<Button disabled={processing || saving || !ready} onClick={() => setImage(exampleImage())}>使用示例插画</Button></div>
        <Button type="primary" size="large" block icon={<PlayCircleOutlined aria-hidden="true" />} disabled={!selected || processing || !ready} loading={saving} onClick={() => void demonstrate()}>查看演示结果</Button>
        <p className="helper">图片在本地处理，演示后保存一条体验记录。可切换到摄像头查看实时画面。</p></>}
      </Card></section>
      <section><div className="section-heading"><span className="step-number">02</span><h2>观察分类结果</h2></div><Card className="experience-result-card">
        {displayed ? <><div className="experience-result-heading"><span>{source==='camera'?'摄像头 · 示例排名第一':'示例排名第一'}</span><Tag color="gold">模拟结果</Tag></div><div className="experience-top-result"><b>{displayed.scores[0].label}</b><span>62<small>%</small></span></div><p className="result-disclaimer">固定演示值，与图片内容无关。</p><div className="experience-score-list">{displayed.scores.map((item,index) => <div className="score-row" key={item.label}><div><span>{item.label}</span><b>{Math.round(item.score*100)}%</b></div><div className="score-track"><span style={{ width: `${item.score*100}%`, background: ['#3b82db','#64b6a2','#e9b267'][index] }} /></div></div>)}</div><div className="score-explanation">真实模型的预测分数也不等于整体准确率。需要对照正确类别，在一组独立图片上评价效果。</div></> : <div className="experience-result-empty"><PictureOutlined aria-hidden="true" /><h3>{source==='camera'?'等待摄像头画面':'图片准备好了吗？'}</h3><p>{source==='camera'?'开启摄像头后，这里会持续展示演示结果。':'选择图片后，点击“查看演示结果”。'}<br/>尚未接入真实分类模型。</p></div>}
      </Card></section>
    </div>
    <section className="experience-challenge"><div><span className="challenge-eyebrow"><BulbOutlined aria-hidden="true" /> 观察小挑战</span><h2>换个角度，结果会一样吗？</h2><p>将同一物体转动或移远，定格画面并写下你的猜想。<br/>当前先练习记录；接入真实模型后，再验证结果是否变化。</p><div className="challenge-steps"><span>① 保持物体相同</span><span>② 只改变角度</span><span>③ 对比并记录</span></div></div><div className="observation-editor"><label htmlFor="experience-note">我的观察与猜想</label><Input.TextArea id="experience-note" value={note} onChange={event => setNote(event.target.value)} disabled={!current || saving || source==='camera'} maxLength={500} showCount autoSize={{ minRows: 3, maxRows: 5 }} placeholder={source==='camera'?'先点击“定格并记录”，再填写这次观察。':'例如：换个角度后，物体的形状看起来不一样了……'} /><Button icon={<SaveOutlined aria-hidden="true" />} disabled={!current || saving || source==='camera'} loading={saving} onClick={() => void saveNote()}>保存观察</Button></div></section>
    <section className="experience-history"><div className="hub-section-heading"><div><h2>我的体验记录 <span>{records.length}/12</span></h2><p>最近 12 次演示仅保存在当前浏览器；导出不包含图片。</p></div><Button disabled={!records.length || saving} onClick={exportRecords}>导出演示记录</Button></div>
      {!records.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成一次演示后，记录会出现在这里。" /> : <div className="experience-record-grid">{records.map(record => <article key={record.id} className="experience-record"><button className="experience-record-open" onClick={() => openRecord(record)} disabled={saving}><img src={record.image.dataUrl} alt=""/><div><b>{record.image.name}</b><span>{new Date(record.createdAt).toLocaleString('zh-CN')}</span><small>模拟结果 · 苹果 62%</small><p>{record.note || '还没有填写观察'}</p></div></button><Button type="text" size="small" aria-label={'删除体验记录 '+record.id} disabled={saving} icon={<DeleteOutlined aria-hidden="true" />} onClick={() => remove(record)}/></article>)}</div>}
    </section>
    <div className="experience-next"><div><b>想让模型学习你自己的类别？</b><p>进入图像分类训练，尝试准备数据和配置训练流程。</p></div><Button onClick={onTraining}>去分类训练 <ArrowRightOutlined aria-hidden="true" /></Button></div>
    <ContextAssistant mode="experience" context={`水果分类界面示例；输入来源：${source==='camera'?'摄像头':'文件'}；${selected ? '当前图片：'+selected.name : '尚未选择图片'}；${current ? '已显示固定模拟结果' : '尚未显示结果'}；本机有 ${records.length} 条体验记录。不读取分类训练项目。`} onExperience={() => {}} onTraining={onTraining}/>
  </div>;
}
