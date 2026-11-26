// =============================================================
// Customers who pay together
// =============================================================
// A factory group arrives as one party and pays in one lump (10 × 5,000).
// People belong to one pay group when they carry the same "กลุ่ม" label, or —
// with no label — when the same agent + sub-agent sent them and the amount to
// collect is the same. A label of "-" keeps a person out of any group.
// Only people we collect from, still on the board, and only groups of 2+.
import type { Person, PersonFields } from "./types";

export type PayGroup = { key: string; letter: string; label: string; members: Person[] };

export function payGroupKey(f: PersonFields): string {
  if (f.pay !== "collect") return "";
  const g = (f.group ?? "").trim();
  if (g === "-") return "";
  if (g) return `g:${g.toLowerCase()}`;
  const sub = (f.subAgent ?? "").trim();
  return sub ? `a:${(f.agent ?? "").trim().toLowerCase()}|${sub.toLowerCase()}|${Number(f.amount) || 0}` : "";
}

const letterOf = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/** Pay groups in board order (lettered A, B, C…) and a lookup from person id to its group. */
export function payGroups(people: Person[]): { groups: PayGroup[]; of: Map<string, PayGroup> } {
  const byKey = new Map<string, Person[]>();
  for (const p of people) {
    if (p.cancelled || p.movedTo) continue;
    const k = payGroupKey(p.fields);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(p); byKey.set(k, list);
  }
  const groups: PayGroup[] = [];
  const of = new Map<string, PayGroup>();
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const f = members[0].fields;
    const manual = (f.group ?? "").trim();
    const g: PayGroup = { key, letter: letterOf(groups.length), label: manual || [f.agent, f.subAgent ? `↳ ${f.subAgent}` : ""].filter(Boolean).join(" "), members };
    groups.push(g);
    for (const m of members) of.set(m.id, g);
  }
  return { groups, of };
}

/** Members of a group whose money is still to come in (not yet cash / transfer / paid at the agency). */
export const unpaidOf = (g: PayGroup) => g.members.filter((p) => { const h = p.fields.paidHow ?? "pending"; return h === "pending" || h === "waiting"; });
