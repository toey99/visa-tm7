// POST /api/tm87  multipart: payload (JSON Tm87Data), photo? (image) → filled TM.87 PDF
import { NextRequest, NextResponse } from "next/server";
import { generateTm87Pdf, type Tm87Data } from "@/lib/tm87/generator";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const raw = fd.get("payload");
    if (typeof raw !== "string") return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    const data = JSON.parse(raw) as Tm87Data;
    if (!data.firstName || !data.lastName || !data.passportNo || !data.nationality) return NextResponse.json({ error: "ต้องมี ชื่อ นามสกุล เลขพาสปอร์ต สัญชาติ" }, { status: 400 });
    const photo = fd.get("photo");
    const bytes = await generateTm87Pdf(data, photo instanceof File && photo.size ? new Uint8Array(await photo.arrayBuffer()) : undefined);
    const name = `TM87_${(data.lastName + "_" + data.firstName).replace(/[^A-Za-z0-9_-]+/g, "_").toUpperCase()}.pdf`;
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "TM.87 failed" }, { status: 500 });
  }
}
