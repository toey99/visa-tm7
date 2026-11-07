import { NextRequest, NextResponse } from "next/server";
import { generateTm7Pdf as generateBangkok, type Tm7FormData } from "@/lib/tm7-generator";
import { generateTm7PdfNonthaburi as generateNonthaburi } from "@/lib/tm7-generator-nonthaburi";
import { generateTm7Pdf as generateRayong } from "@/lib/rayong/tm7-generator";
import { OFFICES, DEFAULT_OFFICE, isOfficeId, type OfficeId } from "@/lib/offices";
import { buildTm7Filename } from "@/lib/tm7-filename";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const payloadRaw = formData.get("payload");
    if (typeof payloadRaw !== "string") {
      return NextResponse.json(
        { error: "Missing form payload." },
        { status: 400 }
      );
    }
    const data = JSON.parse(payloadRaw) as Tm7FormData & { office?: string };
    const office: OfficeId = isOfficeId(data.office) ? data.office : DEFAULT_OFFICE;
    data.formLocation = OFFICES[office].formLocation;

    if (!data?.firstName || !data?.lastName || !data?.passportNo || !data?.nationality || !data?.title) {
      return NextResponse.json(
        { error: "Missing required fields: title, firstName, lastName, nationality, passportNo." },
        { status: 400 }
      );
    }

    const tm30 = formData.get("tm30");
    let tm30Bytes: Uint8Array | undefined;
    if (tm30 instanceof File && tm30.size > 0) {
      tm30Bytes = new Uint8Array(await tm30.arrayBuffer());
    }

    let pdfBytes: Uint8Array;
    switch (OFFICES[office].generator) {
      case "nonthaburi":
        pdfBytes = await generateNonthaburi(data, tm30Bytes);
        break;
      case "rayong":
        pdfBytes = await generateRayong({ ...data, office: office === "CHIANG_SAEN" ? "CHIANG_SAEN" : "RAYONG" }, tm30Bytes);
        break;
      default:
        pdfBytes = await generateBangkok(data, tm30Bytes);
    }
    const filename = buildTm7Filename(data.lastName, data.firstName);
    // Provide both a plain `filename` (for older/legacy agents) and an
    // RFC 5987 `filename*` so spaces and any non-ASCII survive on
    // Android/iOS browsers that would otherwise strip them.
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    const encoded = encodeURIComponent(filename);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF generation failed";
    if (msg.includes("WinAnsi") || msg.includes("cannot encode")) {
      return NextResponse.json(
        { error: "Please ensure all fields contain only English characters." },
        { status: 400 }
      );
    }
    console.error("[TM7 API] Generation failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
