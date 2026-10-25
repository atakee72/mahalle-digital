// Browser-only: shrink a picked photo before upload (Vercel's 4.5 MB body cap).
// All decisions live in ./shrinkRules. Never throws — on any failure the original file is returned.
import { planShrink, nextAttempt, uploadFileName, UPLOAD_MAX_BYTES } from './shrinkRules';

type Source = { draw: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: File): Promise<Source | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { draw: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    /* fall through to <img> */
  }
  let url: string | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function encode(src: Source, width: number, height: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src.draw, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src.draw, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
}

export async function shrinkForUpload(file: File, opts: { maxEdge?: number } = {}): Promise<File> {
  let src: Source | null = null;
  try {
    src = await decode(file);
    if (!src) return file;
    const plan = planShrink({ width: src.width, height: src.height, bytes: file.size, type: file.type }, opts.maxEdge);
    if (plan.action === 'pass') return file;
    let attempt: { width: number; height: number; quality: number } | null = plan;
    let blob: Blob | null = null;
    while (attempt) {
      blob = await encode(src, attempt.width, attempt.height, attempt.quality);
      if (blob.size <= UPLOAD_MAX_BYTES) break;
      attempt = nextAttempt(attempt);
    }
    if (!blob) return file;
    return new File([blob], uploadFileName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    try {
      src?.close();
    } catch {
      /* ignore */
    }
  }
}
