// Push a freshly drawn summary sheet into a LINE group (after a counter
// command, or on "รูป"). The PNG is kept under the board's out/ folder and
// served to LINE through a signed public link, like the pictures sent from
// the board's own 📲 buttons.
import { blobPut } from "@/lib/blob";
import { boardFolder } from "@/lib/day-server";
import { linePushMessages } from "@/lib/d90/line";
import { OFFICES } from "@/lib/offices";
import { signPath } from "@/lib/pub";
import { renderSummaryPng, type SummaryTarget } from "./render";

export async function pushSummaryPicture(groupId: string, origin: string, target: SummaryTarget, dayKey: string, agent = "", caption = ""): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const r = await renderSummaryPng(target, dayKey, agent);
    const id = `${Date.now().toString(36)}-line`;
    const full = await blobPut(`${boardFolder(target.ns, dayKey, target.office)}out/${id}.png`, r.png, "image/png");
    const url = `${origin}/api/pub?t=${signPath(full.pathname)}`;
    const msgs: Array<Record<string, unknown>> = [];
    if (caption) msgs.push({ type: "text", text: caption });
    msgs.push({ type: "image", originalContentUrl: url, previewImageUrl: url });
    const p = await linePushMessages(groupId, msgs);
    if (!p.ok) return { ok: false, error: p.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว" : `LINE ส่งไม่สำเร็จ (${p.status}) ${p.error}` };
    return { ok: true, count: r.count };
  } catch (e) {
    return { ok: false, error: `ทำรูป summary ${OFFICES[target.office].label} ไม่สำเร็จ: ${e instanceof Error ? e.message.slice(0, 160) : "error"}` };
  }
}
