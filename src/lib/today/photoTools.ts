// Client-side photo helpers for the /today board: framing the AI output as a
// visa photo (head found from the white background — no face-detector
// download needed), the A4 print sheet (pdf-lib) and the passport-photo crop
// used when a customer sent no selfie.

export type Crop = { zoom: number; dx: number; dy: number };
export const DEFAULT_CROP: Crop = { zoom: 1, dx: 0, dy: 0 };

// Printed photo size (cm) and the Word-table layout the user prints with.
export const PHOTO_W_CM = 4.0;
export const PHOTO_H_CM = 5.333;
const CELL_W_CM = 4.61;
const CELL_H_CM = 5.36;
const MARGIN_CM = 1.27;
const PER_ROW = 4;
const DPI = 600;

export const loadImage = (src: Blob | string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { if (typeof src !== "string") URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== "string") URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
    img.src = url;
  });

export type HeadBox = { x: number; y: number; w: number; h: number };

// Find the head on a (mostly) white background: first non-white row = top of
// hair; widest span before the shoulders widen = head width.
export function findHeadByBackground(img: HTMLImageElement): HeadBox | null {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = Math.round((S * img.height) / img.width);
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  const rowFill = new Array<number>(H).fill(0);
  const colMin = new Array<number>(H).fill(W);
  const colMax = new Array<number>(H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!(d[i] > 228 && d[i + 1] > 228 && d[i + 2] > 228)) {
        rowFill[y]++;
        if (x < colMin[y]) colMin[y] = x;
        if (x > colMax[y]) colMax[y] = x;
      }
    }
  }
  const top = rowFill.findIndex((v) => v > W * 0.03);
  if (top < 0) return null;
  let headW = 0, headCx = W / 2, prev = 0;
  for (let y = top; y < H; y++) {
    const span = colMax[y] - colMin[y];
    if (span <= 0) continue;
    if (y > top + 10 && span > prev * 1.35 && span > W * 0.45) break; // shoulders
    if (span > headW) { headW = span; headCx = (colMin[y] + colMax[y]) / 2; }
    prev = Math.max(prev, span);
  }
  if (!headW) return null;
  const headH = headW * 1.35;
  const sc = img.width / W;
  // shaped like a detector "face box" (eyebrows→chin ≈ lower 70% of the head)
  return { x: (headCx - headW / 2) * sc, y: (top + headH * 0.3) * sc, w: headW * sc, h: headH * 0.7 * sc };
}

export function cropRect(img: HTMLImageElement, face: HeadBox | null, crop: Crop) {
  const ar = PHOTO_W_CM / PHOTO_H_CM;
  let cx: number, cy: number, h: number;
  if (face) { cx = face.x + face.w / 2; cy = face.y + face.h * 0.5; h = face.h / 0.48; }
  else { cx = img.width / 2; cy = img.height / 2; h = img.height; }
  h = h / crop.zoom;
  let w = h * ar;
  if (w > img.width) { w = img.width; h = w / ar; }
  if (h > img.height) { h = img.height; w = h * ar; }
  cy += crop.dy * h;
  cx += crop.dx * w;
  const x = Math.max(0, Math.min(img.width - w, cx - w / 2));
  const y = Math.max(0, Math.min(img.height - h, cy - h / 2));
  return { x, y, w, h };
}

// Draw the framed photo onto a canvas; whiten light, unsaturated pixels so a
// grey-ish AI background prints as pure white (hair and dark shirts untouched).
export function drawCrop(img: HTMLImageElement, face: HeadBox | null, crop: Crop, canvas: HTMLCanvasElement, pxW: number, pxH: number, whiten = true) {
  canvas.width = pxW;
  canvas.height = pxH;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, pxW, pxH);
  const r = cropRect(img, face, crop);
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, pxW, pxH);
  if (!whiten) return;
  const im = g.getImageData(0, 0, pxW, pxH);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    if (mn > 200 && mx - mn < 28) {
      const t = Math.min(1, (mn - 200) / 30);
      d[i] += (255 - d[i]) * t;
      d[i + 1] += (255 - d[i + 1]) * t;
      d[i + 2] += (255 - d[i + 2]) * t;
    }
  }
  g.putImageData(im, 0, 0);
}

function canvasToJpeg(c: HTMLCanvasElement, q = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", q));
}

// Final print-size photo (600 dpi) as JPEG.
export async function renderPhoto(aiPhoto: Blob, crop: Crop): Promise<Blob> {
  const img = await loadImage(aiPhoto);
  const face = findHeadByBackground(img);
  const c = document.createElement("canvas");
  drawCrop(img, face, crop, c, Math.round((PHOTO_W_CM / 2.54) * DPI), Math.round((PHOTO_H_CM / 2.54) * DPI));
  return canvasToJpeg(c, 0.95);
}

// A4 sheet in the exact Word layout: cells 4.61 × 5.36 cm from 1.27 cm, photo
// 4 × 5.33 cm inside, grey cut lines, 4 per row, new page every 20.
export async function buildPhotoSheetPdf(photos: Blob[]): Promise<Blob> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const PT = 72 / 2.54; // points per cm
  const pdf = await PDFDocument.create();
  const pageW = 21.0 * PT, pageH = 29.7 * PT;
  const rows = Math.floor((29.7 - MARGIN_CM - 0.8) / CELL_H_CM);
  const perPage = rows * PER_ROW;
  const padX = (CELL_W_CM - PHOTO_W_CM) / 2, padY = 0.015;
  let page = pdf.addPage([pageW, pageH]);
  for (let i = 0; i < photos.length; i++) {
    const k = i % perPage;
    if (i > 0 && k === 0) page = pdf.addPage([pageW, pageH]);
    const col = k % PER_ROW, row = Math.floor(k / PER_ROW);
    const xCm = MARGIN_CM + col * CELL_W_CM;
    const yTopCm = MARGIN_CM + row * CELL_H_CM;
    const jpg = await pdf.embedJpg(await photos[i].arrayBuffer());
    page.drawImage(jpg, {
      x: (xCm + padX) * PT,
      y: pageH - (yTopCm + padY + PHOTO_H_CM) * PT,
      width: PHOTO_W_CM * PT,
      height: PHOTO_H_CM * PT,
    });
    page.drawRectangle({
      x: xCm * PT,
      y: pageH - (yTopCm + CELL_H_CM) * PT,
      width: CELL_W_CM * PT,
      height: CELL_H_CM * PT,
      borderColor: rgb(0.35, 0.35, 0.35),
      borderWidth: 0.5,
    });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

// Crop the holder's photo out of a passport bio page using the box Gemini
// returned ("ymin,xmin,ymax,xmax" on a 0–1000 scale), with generous margin so
// the image model has hair and shoulders to work with. Falls back to the left
// third of the page where the photo normally sits.
export async function cropPassportPhoto(passport: Blob, photoBox: string): Promise<Blob> {
  const img = await loadImage(passport);
  const m = photoBox.split(",").map((v) => Number(v.trim()));
  let x0 = 0.03, y0 = 0.15, x1 = 0.38, y1 = 0.8;
  if (m.length === 4 && m.every((v) => Number.isFinite(v))) {
    const [ymin, xmin, ymax, xmax] = m.map((v) => v / 1000);
    const bw = xmax - xmin, bh = ymax - ymin;
    x0 = xmin - bw * 0.25; x1 = xmax + bw * 0.25; y0 = ymin - bh * 0.18; y1 = ymax + bh * 0.12;
  }
  const sx = Math.max(0, x0 * img.width), sy = Math.max(0, y0 * img.height);
  const sw = Math.min(img.width - sx, (x1 - x0) * img.width), sh = Math.min(img.height - sy, (y1 - y0) * img.height);
  const c = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(sw, sh)) * (sw < 500 ? 1024 / Math.max(sw, sh) : 1);
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.92);
}
