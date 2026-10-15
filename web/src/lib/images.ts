/**
 * Prepares a photo for a diary entry in the browser (spec §5.2, ARCHITECTURE §8.3): large photos are scaled to
 * fit 1600 px and compressed to about 500 KB, and every photo is re-encoded as JPEG, which drops its metadata
 * (location included). The user is then told what was done.
 */
import { ENTRY_LIMITS } from '@diary/shared';
import { IMAGE_QUALITIES, IMAGE_TARGET_BYTES, plannedSize } from '../screens/diary/rules.js';

export interface PhotoSize {
  width: number;
  height: number;
  bytes: number;
}

export interface PreparedPhoto {
  dataUrl: string;
  original: PhotoSize;
  result: PhotoSize;
}

/** Why a photo couldn't be used: the browser can't decode it, or it's still too large after compressing. */
export class PhotoError extends Error {
  constructor(readonly reason: 'unreadable' | 'tooLarge') {
    super(reason);
    this.name = 'PhotoError';
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // Applies the camera's rotation, so portrait phone photos stay upright once the metadata is gone.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('unreadable');
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PhotoError('unreadable'))),
      'image/jpeg',
      quality,
    ),
  );
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new PhotoError('unreadable'));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await decode(file);
  const size = plannedSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('unreadable');
  // JPEG has no transparency; a transparent PNG would otherwise turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const original = { width: bitmap.width, height: bitmap.height, bytes: file.size };
  bitmap.close();

  let blob: Blob | null = null;
  for (const quality of IMAGE_QUALITIES) {
    blob = await toBlob(canvas, quality);
    if (blob.size <= IMAGE_TARGET_BYTES) break;
  }
  if (!blob || blob.size > ENTRY_LIMITS.imageBytes) throw new PhotoError('tooLarge');
  return { dataUrl: await toDataUrl(blob), original, result: { ...size, bytes: blob.size } };
}

/** "3.2 MB" / "310 KB". */
export function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
