import type { ImageSample } from '../types';
export function fingerprint(value: string): string { let hash = 2166136261; for (let i=0;i<value.length;i++) hash = Math.imul(hash ^ value.charCodeAt(i),16777619); return (hash>>>0).toString(16); }
export async function prepareImage(file: File): Promise<ImageSample> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请上传 JPG、PNG 或 WebP 格式的图片。');
  if (file.size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5 MB。');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode().catch(() => { throw new Error('这张图片无法读取，请更换完整的图片文件。'); });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。');
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器暂不支持图片预览。');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/jpeg',0.86);
    return {id:crypto.randomUUID(),name:file.name,dataUrl,size:file.size,fingerprint:fingerprint(dataUrl),createdAt:new Date().toISOString()};
  } finally { URL.revokeObjectURL(objectUrl); }
}
