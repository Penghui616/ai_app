import type { Prediction, Project } from '../types';

export type HelpTopic = 'samples' | 'training' | 'testing' | 'question';
export interface ExperimentContext {
  projectId: string;
  projectName: string;
  revision: number;
  capturedAt: string;
  stage: string;
  classes: { name: string; count: number }[];
  run: { id: string; status: string; revision: number; epochs: number } | null;
  hasPrediction: boolean;
  isMock: boolean;
}
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  context?: ExperimentContext;
}
export interface AssistantRequest { question: string; topic: HelpTopic; context: ExperimentContext }
export interface AssistantReply { text: string; context: ExperimentContext }
const storageKey = (id: string) => `vision-lab:assistant:v1:${id}`;
export const HISTORY_LIMIT = 40;

// Only local metadata: images and simulated metric values are intentionally excluded.
export function captureExperiment(project: Project, prediction: Prediction | null): ExperimentContext {
  const active = project.runs.find(run => run.status === 'running');
  const trained = project.runs.find(run => run.status === 'completed' && run.revision === project.revision);
  const ready = project.classes.every(item => item.samples.length >= (import.meta.env.VITE_API_MODE === 'mock' ? 1 : 5));
  return {
    projectId: project.id, projectName: project.name, revision: project.revision,
    capturedAt: new Date().toISOString(),
    stage: active ? '训练中' : trained ? '测试效果' : ready ? '准备训练' : '准备样本',
    classes: project.classes.map(item => ({ name: item.name, count: item.samples.length })),
    run: project.runs[0] ? {
      id: project.runs[0].id, status: project.runs[0].status,
      revision: project.runs[0].revision, epochs: project.runs[0].params.epochs,
    } : null,
    hasPrediction: !!trained && prediction?.runId === trained.id,
    isMock: project.runs[0]?.isMock ?? false,
  };
}

// Deterministic UI demonstration, NOT an LLM or an agent. Replace behind the UI boundary.
export function getDemoReply({ question, topic, context }: AssistantRequest): AssistantReply {
  let text: string;
  if (topic === 'samples') {
    const counts = context.classes.map(item => `“${item.name}”：${item.count} 张`).join('；');
    const empty = context.classes.filter(item => item.count === 0);
    text = `项目样本统计：${counts}。\n\n`;
    if (empty.length) text += `还有 ${empty.length} 个类别没有图片。可以先为这些类别添加样本，再体验训练流程。`;
    else {
      const values = context.classes.map(item => item.count);
      text += Math.max(...values) >= Math.min(...values) * 3
        ? '各类别的样本数量差异较大。真实实验中，可以补充较少类别的不同样本，再用同一组测试图片比较结果；数量差异本身不能证明出错原因。'
        : '各类别都已添加图片。数量统计不能说明样本已经足够，也不能判断标注是否正确。可以检查是否包含不同角度、光线与背景。';
    }
    text += '\n\n这里只读取了类别名称和数量，没有分析图片内容。这是规则生成的演示回复。';
  } else if (topic === 'training') {
    text = context.run
      ? `当前可读取 ${context.run.epochs} 轮配置的训练记录。此助手只读取状态和样本统计，没有分析训练曲线，不能据此诊断过拟合。`
      : '当前还没有训练记录。可以先准备各类别的样本，再体验训练界面。';
    text += '\n\n真实实验中，训练数据用于学习，验证数据用于观察模型对未参与训练样本的表现。当前助手仍为预设回复，不调用大模型。';
  } else if (topic === 'testing') {
    text = context.hasPrediction
      ? '当前页面已有预测结果。请对照物体的真实类别判断是否正确，单张预测分数不是整体准确率。'
      : '当前尚未显示对应模型的预测结果，请使用新图片或摄像头进行校验。';
    text += '\n\n正式实验可以使用未参与训练的新图片，并记录正确类别。比较改进效果时，尽量使用同一组独立测试图片。单张预测分数不等于整体准确率。';
  } else if (/复制|重复/.test(question)) {
    text = '这是一条预设知识提示：把同一张图片复制多遍会增加数量，但不会增加新的角度、背景或物体差异。\n\n正式实验中，可以比较“重复已有图片”和“增加不同的新图片”两种做法，保持其他设置和测试集一致，再观察结果。可以用独立测试图片验证这种差别。';
  } else if (/训练集|测试集|新图片/.test(question)) {
    text = '这是一条预设知识提示：训练图片像练习题，测试图片像没做过的新题。只用练习过的图片测试，不能充分说明模型遇到新图片时的表现。\n\n正式实验应留出独立的测试图片，并避免同一张图片同时用于训练和测试。';
  } else {
    text = '已记录你的问题。当前尚未连接大模型，不能理解并解答任意问题。\n\n你可以先点击“检查样本”“理解训练”或“测试建议”，体验读取本地实验信息的流程。接入 Agent 后，这里会结合真实记录继续追问、查询和解释。';
  }
  return { text, context };
}

export function readAssistantHistory(projectId: string): { messages: AssistantMessage[]; error: string | null } {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return { messages: [], error: null };
    const stored = JSON.parse(raw) as { version?: number; messages?: AssistantMessage[] };
    if (stored.version !== 1 || !Array.isArray(stored.messages)) throw new Error('invalid history');
    const valid = stored.messages.every(message =>
      typeof message.id === 'string' && typeof message.text === 'string' &&
      (message.role === 'user' || message.role === 'assistant') &&
      (!message.context || (message.context.projectId === projectId &&
        typeof message.context.capturedAt === 'string' && Array.isArray(message.context.classes) &&
        message.context.classes.every(item => typeof item.name === 'string' && typeof item.count === 'number'))));
    if (!valid) throw new Error('invalid history');
    return { messages: stored.messages.slice(-HISTORY_LIMIT), error: null };
  } catch {
    return { messages: [], error: '无法读取本地辅导记录。新对话仍可使用，请导出需要保留的内容。' };
  }
}
export function saveAssistantHistory(projectId: string, messages: AssistantMessage[]): boolean {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify({ version: 1, messages: messages.slice(-HISTORY_LIMIT) }));
    return true;
  } catch { return false; }
}
