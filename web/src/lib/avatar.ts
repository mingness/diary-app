/**
 * Profile photos (spec §3, §4.4): cropped to a centred square and resized to 300 × 300 in the browser, as JPEG
 * (which also drops the photo's metadata). The server accepts only such JPEG data URLs, up to 200,000 characters.
 */
const SIZE = 300;
const MAX_CHARS = 200_000;

export async function prepareAvatar(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error('Photo too large');
}
