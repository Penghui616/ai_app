import { useEffect, useRef } from 'react';
import { Alert, Button, Empty, Modal, Progress, Tag, Tabs } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { TrainingRun } from '../types';
echarts.use([LineChart,GridComponent,TooltipComponent,LegendComponent,CanvasRenderer]);
function MetricsChart({run,kind}:{run:TrainingRun;kind:'loss'|'accuracy'}){
 const node=useRef<HTMLDivElement>(null);const chart=useRef<echarts.ECharts|null>(null);
 useEffect(()=>{if(!node.current)return;const instance=echarts.init(node.current);chart.current=instance;const observer=new ResizeObserver(()=>instance.resize());observer.observe(node.current);return()=>{observer.disconnect();instance.dispose();chart.current=null;};},[]);
 useEffect(()=>{chart.current?.setOption({animationDuration:250,color:['#3978e8','#e4a444'],tooltip:{trigger:'axis'},legend:{bottom:0,icon:'circle',itemWidth:8,itemHeight:8,textStyle:{fontSize:11,color:'#8391a5'}},grid:{left:44,right:16,top:20,bottom:57},xAxis:{type:'category',boundaryGap:false,data:run.metrics.map(m=>m.epoch),axisTick:{show:false},axisLine:{lineStyle:{color:'#dde5f0'}},axisLabel:{color:'#91a0b3'}},yAxis:{type:'value',min:0,max:kind==='accuracy'?100:undefined,axisLabel:{color:'#91a0b3',formatter:kind==='accuracy'?'{value}%':'{value}'},splitLine:{lineStyle:{color:'#eff3f8'}}},series:kind==='loss'?[{name:'训练损失',type:'line',smooth:true,symbolSize:5,data:run.metrics.map(m=>m.trainLoss)},{name:'验证损失',type:'line',smooth:true,symbolSize:5,data:run.metrics.map(m=>m.valLoss)}]:[{name:'验证准确率',type:'line',smooth:true,symbolSize:5,areaStyle:{color:'#3978e80b'},data:run.metrics.map(m=>Number((m.accuracy*100).toFixed(1)))}]});},[run,kind]);
 return <div ref={node} className="metric-chart" role="img" aria-label={kind==='loss'?'损失曲线':'验证准确率曲线'}/>;
}
export default function TrainingMonitor({run,open,onClose,onCancel}:{run:TrainingRun|undefined;open:boolean;onClose:()=>void;onCancel:()=>void}){
 if(!run)return null;
 const last=run.metrics.at(-1);const progress=Math.round(run.metrics.length/run.params.epochs*100);
 const statusText={running:'训练中',completed:'训练完成',cancelled:'已取消',failed:'训练失败'}[run.status];
 return <Modal open={open} title={<span className="modal-title">训练监控 <Tag color={run.isMock?'gold':'green'}>{run.isMock?'模拟数据':'真实训练'}</Tag></span>} onCancel={onClose} width={880} footer={<div className="monitor-footer"><span>{run.isMock?'刷新页面会停止演示。':'训练在后端执行，关闭弹窗或刷新不会取消。'}</span><div>{run.status==='running'&&<Button danger onClick={onCancel}>取消训练</Button>}<Button type={run.status==='completed'?'primary':'default'} onClick={onClose}>{run.status==='completed'?'完成，去测试':'关闭弹窗'}</Button></div></div>} styles={{body:{maxHeight:'72vh',overflowY:'auto'}}} destroyOnHidden>
 <Alert type="warning" showIcon message={run.isMock?'当前为模拟记录。':'冻结 MobileNetV3，仅训练分类层。验证集约占每类 20%，并非独立测试集；连拍相似样本可能高估效果。'} style={{marginBottom:20}}/>
 <div className="run-status"><div>{run.status==='running'?<LoadingOutlined aria-hidden="true"/>:run.status==='completed'?<CheckCircleOutlined aria-hidden="true"/>:<CloseCircleOutlined aria-hidden="true"/>}<b>{statusText}</b></div><span>{run.metrics.length} / {run.params.epochs} 轮</span></div>
 <p className="helper">{run.message}{run.stage==='extracting'?` · 特征提取 ${run.featureProgress??0}%`:''}</p><Progress percent={progress} status={run.status==='failed'?'exception':run.status==='completed'?'success':run.status==='running'?'active':'normal'} strokeColor="#3978e8"/>
 <div className="metric-summary"><div><span>训练损失</span><strong>{last?.trainLoss.toFixed(4)??'—'}</strong></div><div><span>验证损失</span><strong>{last?.valLoss.toFixed(4)??'—'}</strong></div><div><span>验证准确率</span><strong>{last?(last.accuracy*100).toFixed(1)+'%':'—'}</strong></div></div>
 <Tabs items={[{key:'charts',label:'训练曲线',children:run.metrics.length?<div className="charts-grid"><section><h3>损失变化</h3><MetricsChart run={run} kind="loss"/></section><section><h3>准确率变化</h3><MetricsChart run={run} kind="accuracy"/></section></div>:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在提取特征并准备训练曲线"/>},{key:'logs',label:'运行日志',children:<div className="log-panel" aria-label="训练日志"><p>[训练] 样本 {run.sampleCount} 张 · {run.params.optimizer} · 学习率 {run.params.learningRate}</p><p>[训练] 优化器、学习率、批大小和轮数作用于分类层，特征提取网络保持冻结。</p>{run.metrics.map(m=><p key={m.epoch}>[训练] Epoch {m.epoch}/{run.params.epochs} · loss {m.trainLoss.toFixed(4)} · val_loss {m.valLoss.toFixed(4)} · accuracy {(m.accuracy*100).toFixed(1)}%</p>)}<p>[状态] {run.message}</p></div>}]}/>
 </Modal>;
}
