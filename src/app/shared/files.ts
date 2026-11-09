/** Browser-side file helpers for scanning: base64 encoding and image shrinking. */

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Re-encode an image as JPEG with its longest side ≤ maxDim. Also fixes phone photos' EXIF rotation.
 * Returns null if this browser can't decode the format (e.g. HEIC on Chrome); callers then use the original.
 */
export async function shrinkImage(file: Blob, maxDim: number, quality: number): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** Shrink until the JPEG fits the byte budget (for receipt copies kept in Firestore). */
export async function shrinkToBudget(file: Blob, maxBytes: number): Promise<Blob | null> {
  for (const [dim, q] of [[1400, 0.72], [1200, 0.62], [1000, 0.55], [800, 0.5]] as const) {
    const b = await shrinkImage(file, dim, q);
    if (!b) return null;
    if (b.size <= maxBytes) return b;
  }
  return null;
}

export const isImage = (mime: string) => /^image\//.test(mime);
export const isPdf = (mime: string) => mime === 'application/pdf';
export const SUPPORTED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;
