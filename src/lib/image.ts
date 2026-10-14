/** Client-side image → data-URI pipeline for the card editor.
 *
 * Files are downscaled on a canvas so stored cards stay light:
 *   - long edge ≤ 640px
 *   - PNG/WebP/GIF-with-alpha try PNG first (transparency), falling back to
 *     JPEG when the PNG result would blow the size budget
 *   - JPEG goes straight to JPEG (quality 0.82)
 *   - GIFs skip the canvas entirely (animation would be lost) and are only
 *     accepted when the raw payload is small enough
 *
 * The final data URI must fit the backend's MAX_DATA_URI_LENGTH (700,000
 * chars) — this module targets a ~450KB budget before base64 (+~33%) to
 * stay comfortably inside it.
 */

const MAX_LONG_EDGE = 640;

/** Mimes the backend accepts for data URIs (svg is deliberately banned). */
export const IMAGE_MIME_ALLOWLIST = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export class ImageTooLargeError extends Error {
  constructor(message = "Image too large even after compression — try a smaller one.") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file doesn't look like a valid image."));
    img.src = src;
  });
}

function canvasToDataUri(img: HTMLImageElement, mime: "image/png" | "image/jpeg"): string {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  if (mime === "image/jpeg") {
    // JPEG has no alpha channel — flatten onto white instead of black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mime, mime === "image/jpeg" ? 0.82 : undefined);
}

/** Convert a picked/dropped/pasted image file into a storable data URI.
 * Throws Error (user-facing message) for wrong mime or an incompressible
 * oversized file. */
export async function fileToDataUri(file: File): Promise<string> {
  if (!IMAGE_MIME_ALLOWLIST.includes(file.type as (typeof IMAGE_MIME_ALLOWLIST)[number])) {
    throw new Error("Unsupported image type — use PNG, JPEG, WebP or GIF.");
  }

  const raw = await readAsDataUri(file);

  // GIFs: re-encoding would drop the animation — accept small ones as-is.
  if (file.type === "image/gif") {
    if (raw.length > 700_000) throw new ImageTooLargeError();
    return raw;
  }

  const img = await loadImage(raw);

  // PNG/WebP may carry transparency → try PNG first, fall back to JPEG.
  if (file.type !== "image/jpeg") {
    const png = canvasToDataUri(img, "image/png");
    if (png.length <= 700_000) return png;
  }
  const jpeg = canvasToDataUri(img, "image/jpeg");
  if (jpeg.length <= 700_000) return jpeg;
  throw new ImageTooLargeError();
}

/** Rough display size for a data URI (the binary size after base64). */
export function dataUriKb(dataUri: string): number {
  const base64 = dataUri.split(",")[1] ?? "";
  return Math.round((base64.length * 0.75) / 1024);
}
