// Saved document checklists (one small file per checklist kind).
import { blobGetJson, blobPut } from "@/lib/blob";
import type { CheckRec } from "./nonb90";

const PATH = "checklists/nonb90.json";
const MAX = 300;   // oldest untouched records fall off the end

export async function listChecks(): Promise<CheckRec[]> {
  return (await blobGetJson<CheckRec[]>(PATH)) ?? [];
}
export async function saveCheck(rec: CheckRec): Promise<CheckRec> {
  const list = await listChecks();
  const now = new Date().toISOString();
  const i = list.findIndex((x) => x.id === rec.id);
  const next = { ...rec, createdAt: (i >= 0 ? list[i].createdAt : rec.createdAt) || now, updatedAt: now };
  if (i >= 0) list.splice(i, 1);
  list.unshift(next);
  await blobPut(PATH, JSON.stringify(list.slice(0, MAX)), "application/json");
  return next;
}
export async function removeCheck(id: string): Promise<void> {
  const list = await listChecks();
  const left = list.filter((x) => x.id !== id);
  if (left.length !== list.length) await blobPut(PATH, JSON.stringify(left), "application/json");
}
