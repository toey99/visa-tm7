// =============================================================
// POST /api/make-photo — turn a selfie / passport photo into a studio-style
// white-background visa photo for the /today board.
// =============================================================
// multipart: image (File), prompt (string), provider ("openai" | "gemini"),
//            model (optional OpenAI model id)
// Returns a JPEG (image/jpeg). Uses OPENAI_API_KEY (gpt-image-1.5 edits,
// input_fidelity=high so the face stays the customer's) or, when asked,
// GEMINI_API_KEY with gemini-2.5-flash-image.
//
// Image generation takes 20–50 s, so this is a route handler (not a server
// action) with maxDuration raised to the Vercel Hobby ceiling.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_DEFAULT_MODEL = "gpt-image-1.5";
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const image = formData.get("image");
    const prompt = String(formData.get("prompt") ?? "").trim();
    const provider = String(formData.get("provider") ?? "openai");
    const model = String(formData.get("model") ?? "") || OPENAI_DEFAULT_MODEL;

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: "No image was provided." }, { status: 400 });
    }
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large (max 4 MB)." }, { status: 400 });
    }
    if (!prompt) return NextResponse.json({ error: "Missing prompt." }, { status: 400 });

    const bytes = provider === "gemini" ? await viaGemini(image, prompt) : await viaOpenAI(image, prompt, model);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Photo generation failed";
    console.error("[make-photo] failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function viaOpenAI(image: File, prompt: string, model: string): Promise<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Server is missing OPENAI_API_KEY (add it in Vercel → Environment Variables, Preview + Production).");
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", prompt);
  fd.append("size", "1024x1536");
  fd.append("quality", "medium");
  fd.append("output_format", "jpeg");
  fd.append("output_compression", "90");
  if (model === "gpt-image-1.5" || model === "gpt-image-1") fd.append("input_fidelity", "high");
  fd.append("image", image, "in.jpg");

  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = (await r.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image.");
  return Buffer.from(b64, "base64");
}

async function viaGemini(image: File, prompt: string): Promise<Uint8Array> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Server is missing GEMINI_API_KEY.");
  const b64in = Buffer.from(await image.arrayBuffer()).toString("base64");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.type || "image/jpeg", data: b64in } }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
      }),
    },
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string } }> }; finishReason?: string }> };
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error(`Gemini returned no image (${j.candidates?.[0]?.finishReason ?? "?"}).`);
  return Buffer.from(part.inlineData.data, "base64");
}
