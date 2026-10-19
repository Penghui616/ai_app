export type SpeechLanguage = 'auto' | 'zh' | 'en';
export interface SpeechInput { audio: Blob; language: SpeechLanguage; durationSeconds: number }
export interface SpeechResult {
  text: string;
  durationSeconds: number;
  elapsedMs: number;
  noSpeech: boolean;
  notice: string;
  model: string;
}
export interface SpeechStatus { available: boolean; message: string; model: string; busy: boolean }

async function request(path: string, init: RequestInit, timeout: number): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
      throw new Error(typeof detail === 'string' ? detail : response.status === 404 ? '语音接口尚未启用，请重启更新后的后端。' : `语音服务不可用（HTTP ${response.status}），请稍后重试。`);
    }
    return data;
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('语音请求超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接语音服务，请确认后端已启动。');
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export const speechService = {
  async status(signal: AbortSignal): Promise<SpeechStatus> {
    const data = await request('/api/speech/status', { signal }, 10000);
    if (!data || typeof data !== 'object' || !('available' in data) || typeof data.available !== 'boolean' || !('message' in data) || typeof data.message !== 'string' || !('model' in data) || typeof data.model !== 'string' || !('busy' in data) || typeof data.busy !== 'boolean') throw new Error('语音服务状态格式异常。');
    return data as SpeechStatus;
  },
  async transcribe(input: SpeechInput, signal: AbortSignal): Promise<SpeechResult> {
    // No reference text, filenames, or project context goes to the ASR endpoint.
    const data = await request(`/api/speech/transcribe?language=${encodeURIComponent(input.language)}`, {
      method: 'POST', signal, headers: { 'Content-Type': input.audio.type || 'application/octet-stream' }, body: input.audio,
    }, 100000);
    if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string' ||
        !('durationSeconds' in data) || typeof data.durationSeconds !== 'number' || !Number.isFinite(data.durationSeconds) || data.durationSeconds < 0 ||
        !('elapsedMs' in data) || typeof data.elapsedMs !== 'number' || !Number.isFinite(data.elapsedMs) || data.elapsedMs < 0 ||
        !('noSpeech' in data) || typeof data.noSpeech !== 'boolean' || !('notice' in data) || typeof data.notice !== 'string' || !('model' in data) || typeof data.model !== 'string') throw new Error('语音识别结果格式异常，请重试。');
    return data as SpeechResult;
  },
};
