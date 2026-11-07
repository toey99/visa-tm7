// Client-only utility for shrinking oversized TM.30 PDFs before upload.
//
// A TM.30 receipt is often a full-page scan/photo embedded as one large image,
// which can push the PDF past the ~4.5MB Server Action / Vercel upload ceiling.
// pdf.js rasterizes each page to a canvas, we re-encode it as JPEG, and pdf-lib
// rebuilds a smaller image-based PDF. Gemini reads the TM.30 as an image for OCR
// anyway, so flattening the text layer costs nothing for the scan — and the
// smaller PDF is also what we attach to the final packet (the original would be
// too big to upload there either).
//
// The heavy deps (pdf.js ~1MB, pdf-lib) are loaded via dynamic import so they
// only download when a user actually uploads an oversized PDF.

// Longest edge to render each page at: high enough for reliable OCR and a legible
// printed attachment, low enough to compress well.
const RENDER_MAX_EDGE = 2200;
const JPEG_QUALITY = 0.8;

export async function compressPdf(file: File): Promise<File> {
  // Use the "legacy" pdf.js build — it targets a broader range of browsers
  // (notably older Android WebViews) than the default modern build.
  const [pdfjs, { PDFDocument }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdf-lib"),
  ]);

  // Bundle the matching worker as a module Worker via the app bundler — no CDN
  // dependency, and versions can never drift out of sync.
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  try {
    const out = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const scale = RENDER_MAX_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");

      // Flatten onto white — PDF pages can be transparent, and JPEG has no alpha,
      // so an unset background would otherwise render black.
      await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) throw new Error("toBlob failed");
      const jpeg = new Uint8Array(await blob.arrayBuffer());

      const img = await out.embedJpg(jpeg);
      const outPage = out.addPage([canvas.width, canvas.height]);
      outPage.drawImage(img, { x: 0, y: 0, width: canvas.width, height: canvas.height });

      page.cleanup();
    }

    const bytes = await out.save();
    const name = file.name.replace(/\.pdf$/i, "") || "tm30";
    // pdf-lib returns a generic Uint8Array; it is a valid BlobPart at runtime.
    return new File([bytes as unknown as BlobPart], `${name}-compressed.pdf`, {
      type: "application/pdf",
    });
  } finally {
    await loadingTask.destroy();
  }
}
