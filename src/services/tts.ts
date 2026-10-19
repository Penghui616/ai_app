export interface TtsInput { text: string; voice: string; speed: number; pitch: number; volume: number }
export interface TtsStatus { available: boolean; busy: boolean; message: string; model: string }

async function request(path: string, signal: AbortSignal, input?: TtsInput): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, input ? 95000 : 10000);
  try {
    const response = await fetch(path, { signal: controller.signal, ...(input ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    } : {}) });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
      throw new Error(typeof detail === 'string' ? detail : response.status === 404 ? '合成接口尚未启用，请重启更新后的后端。' : `合成服务不可用（HTTP ${response.status}）。`);
    }
    // Buffer inside the timeout, so a stalled response body also gets aborted.
    const blob = await response.blob();
    if (blob.size > 6_000_000) throw new Error('返回的音频过大，请缩短文字后重试。');
    return new Response(blob, { headers: response.headers });
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('语音合成请求超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接合成服务，请确认后端已启动。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export const ttsService = {
  async status(signal: AbortSignal): Promise<TtsStatus> {
    const response = await request('/api/tts/status', signal);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('available' in data) || typeof data.available !== 'boolean' || !('busy' in data) || typeof data.busy !== 'boolean' || !('message' in data) || typeof data.message !== 'string' || !('model' in data) || typeof data.model !== 'string') throw new Error('合成服务状态格式异常。');
    return data as TtsStatus;
  },
  async synthesize(input: TtsInput, signal: AbortSignal): Promise<Blob> {
    const response = await request('/api/tts/synthesize', signal, input);
    const blob = await response.blob();
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (!response.headers.get('content-type')?.startsWith('audio/wav') || blob.size <= 44 || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') throw new Error('合成音频格式异常，请重试。');
    return blob;
  },
};
