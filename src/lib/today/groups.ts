// =============================================================
// Customers who pay together
// =============================================================
// A factory group arrives as one party and pays in one lump (10 × 5,000).
// People belong to one pay group when they carry the same "กลุ่ม" label, or —
// with no label — when the same agent + sub-agent sent them and the amount to
// collect is the same. A label of "-" keeps a person out of any group.
// Only people we collect from, still on the board, and only groups of 2+.
import type { Person, PersonFields } from "./types";

// Rec: a board person as the browser holds it (Person) or as the server reads it (PersonRec, loose fields)
type Fields = Partial<PersonFields> | Record<string, unknown>;
type Rec = { id: string; cancelled?: unknown; movedTo?: unknown; fields?: Fields };
export type PayGroup<T extends Rec = Person> = { key: string; index: number; letter: string; label: string; members: T[] };

// one bright pastel per group (A, B, C… cycle) — tint behind the member, edge for frames and badges
export const GROUP_COLORS = [
  { bg: "#fce7f3", edge: "#ec4899", fg: "#9d174d" }, { bg: "#e0f2fe", edge: "#0ea5e9", fg: "#075985" }, { bg: "#dcfce7", edge: "#22c55e", fg: "#166534" },
  { bg: "#ede9fe", edge: "#8b5cf6", fg: "#5b21b6" }, { bg: "#ffedd5", edge: "#f97316", fg: "#9a3412" }, { bg: "#fef9c3", edge: "#eab308", fg: "#854d0e" },
];
export const groupColor = (g: { index: number }) => GROUP_COLORS[g.index % GROUP_COLORS.length];

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
export function payGroupKey(fields: Fields | undefined): string {
  const f = (fields ?? {}) as Record<string, unknown>;
  if (f.pay !== "collect") return "";
  const g = s(f.group);
  if (g === "-") return "";
  if (g) return `g:${g.toLowerCase()}`;
  const sub = s(f.subAgent);
  return sub ? `a:${s(f.agent).toLowerCase()}|${sub.toLowerCase()}|${Number(f.amount) || 0}` : "";
}

const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/** Pay groups in board order (lettered A, B, C…) and a lookup from person id to its group. */
export function payGroups<T extends Rec = Person>(people: T[]): { groups: PayGroup<T>[]; of: Map<string, PayGroup<T>> } {
  const byKey = new Map<string, T[]>();
  for (const p of people) {
    if (p.cancelled || p.movedTo) continue;
    const k = payGroupKey(p.fields);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(p); byKey.set(k, list);
  }
  const groups: PayGroup<T>[] = [];
  const of = new Map<string, PayGroup<T>>();
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const f = (members[0].fields ?? {}) as Record<string, unknown>;
    const manual = s(f.group);
    const g: PayGroup<T> = { key, index: groups.length, letter: letterOf(groups.length), label: manual || [s(f.agent), s(f.subAgent) ? `↳ ${s(f.subAgent)}` : ""].filter(Boolean).join(" "), members };
    groups.push(g);
    for (const m of members) of.set(m.id, g);
  }
  return { groups, of };
}

/** Members of a group whose money is still to come in (not yet cash / transfer / paid at the agency). */
/** What a group still owes / owes in all (THB). */
export const groupTotal = <T extends Rec>(g: PayGroup<T>) => g.members.reduce((t, m) => t + (Number((m.fields as Record<string, unknown> | undefined)?.amount) || 0), 0);
export const unpaidOf = (g: PayGroup) => g.members.filter((p) => { const h = p.fields.paidHow ?? "pending"; return h === "pending" || h === "waiting"; });
