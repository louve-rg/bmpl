/** Longest edge of a stored avatar. Displayed at 96px at most, so 512 covers retina. */
export const AVATAR_MAX_EDGE = 512;

/**
 * Centre-crop an image to a square and downscale it, in the browser, before it is
 * uploaded.
 *
 * Two reasons this happens client-side rather than on the API:
 *  - a modern phone camera produces 3–8 MB files that would otherwise be stored
 *    and re-downloaded in full to be drawn at 32px in a sidebar;
 *  - avatars are rendered in circles everywhere, so a portrait or landscape
 *    original is going to be cropped regardless — doing it here means the user
 *    sees the same framing we store, instead of discovering later that their
 *    head was cut off.
 *
 * Returns the original File untouched if anything goes wrong (unreadable image,
 * no canvas support, blob encode failure). The upload is the important part; the
 * optimisation is not worth failing over, and the API enforces its own size cap.
 */
export async function cropAndResizeSquare(
  file: File,
  maxEdge: number = AVATAR_MAX_EDGE,
): Promise<File> {
  try {
    const bitmap = await loadBitmap(file);
    // Centre square crop: take the largest square that fits, from the middle.
    const edge = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - edge) / 2);
    const sy = Math.round((bitmap.height - edge) / 2);
    // Never upscale — a 200px original stays 200px rather than being blurred up.
    const target = Math.min(edge, maxEdge);

    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, target, target);
    close(bitmap);

    // JPEG for photographs; a PNG selfie is needlessly large and has no alpha
    // worth keeping once it is cropped to a filled circle.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) return file;
    return new File([blob], renameToJpeg(file.name), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap applies EXIF orientation; without it, photos taken in
  // portrait on iOS arrive rotated 90°.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function close(bitmap: ImageBitmap | HTMLImageElement): void {
  if ('close' in bitmap) bitmap.close();
}

const renameToJpeg = (name: string): string => `${name.replace(/\.[^.]+$/, '') || 'avatar'}.jpg`;
