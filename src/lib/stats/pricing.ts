// =============================================================
// Pricing — sale prices (what agents / direct customers are charged) and
// our costs, per office and job type. Used by the daily stats + dashboard.
// =============================================================
// Stored at pricing/config.json; these defaults are the numbers given on
// 17/11/2026. Everything is editable on /dashboard ⚙️.
import type { OfficeId } from "@/lib/offices";

export type ExtPrice = { default: number; byAgent: Record<string, number> };
export type Pricing = {
  sale: {
    ext: Record<OfficeId, ExtPrice>;      // 30-day extension (CHIANG_SAEN = the +30 after a run)
    runShared: number;                     // visa run, 2+ in the car, per head
    runSolo: number;                       // visa run, alone in the car
    run30: number;                         // 🐰 +30 per head (on top of the run)
    cambodia: number;                      // 🐻 per head
    overstayBase: number;                  // overstay handling per head
    overstayPerDay: number;                // fine per day (passed on)
    vip: number;
    d90: number;
  };
  cost: {
    ext: Record<OfficeId, number>;
    runPerHead: Record<1 | 2 | 3 | 4, number>;  // all-in per head by how many ride in the car
    run30: number;                         // our cost of the +30 at Chiang Saen
    cambodia: number;
    overstayPerDay: number;                // the fine we pay at the counter
    vip: number;
    d90: number;
  };
  updatedAt?: string;
};

export const DEFAULT_PRICING: Pricing = {
  sale: {
    ext: {
      BANGKOK: { default: 4000, byAgent: { "อาเต่า": 3700, "พี่ปิ๊ก": 3800 } },
      NONTHABURI: { default: 4500, byAgent: { "อาเต่า": 4700 } },
      RAYONG: { default: 5000, byAgent: { "อาเต่า": 4700 } },
      VFS_BANGKOK: { default: 3200, byAgent: {} },
      VFS_PATTAYA: { default: 4500, byAgent: {} },
      CHIANG_SAEN: { default: 4500, byAgent: {} },
    },
    runShared: 9500,
    runSolo: 10000,
    run30: 4500,
    cambodia: 7500,
    overstayBase: 2000,
    overstayPerDay: 500,
    vip: 500,
    d90: 1000,
  },
  cost: {
    ext: { BANGKOK: 3000, NONTHABURI: 4000, RAYONG: 4500, VFS_BANGKOK: 2400, VFS_PATTAYA: 3400, CHIANG_SAEN: 4000 },
    runPerHead: { 1: 9800, 2: 9000, 3: 8350, 4: 8150 },
    run30: 4000,          // assumed = Chiang Saen extension cost; confirm
    cambodia: 7500,
    overstayPerDay: 500,  // the fine itself; the 2,000 handling is margin
    vip: 500,
    d90: 500,
  },
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export function extSale(p: Pricing, office: OfficeId, agent: string): number {
  const e = p.sale.ext[office];
  if (!e) return 0;
  const k = Object.keys(e.byAgent).find((a) => norm(a) === norm(agent));
  return k ? e.byAgent[k] : e.default;
}

/** Deep-merge a stored config over the defaults so new keys always exist. */
export function withDefaults(c: Partial<Pricing> | null | undefined): Pricing {
  const d = DEFAULT_PRICING;
  const ext = { ...d.sale.ext } as Pricing["sale"]["ext"];
  for (const k of Object.keys(ext) as OfficeId[]) ext[k] = { default: c?.sale?.ext?.[k]?.default ?? d.sale.ext[k].default, byAgent: { ...d.sale.ext[k].byAgent, ...(c?.sale?.ext?.[k]?.byAgent ?? {}) } };
  return {
    sale: { ...d.sale, ...(c?.sale ?? {}), ext },
    cost: { ...d.cost, ...(c?.cost ?? {}), ext: { ...d.cost.ext, ...(c?.cost?.ext ?? {}) }, runPerHead: { ...d.cost.runPerHead, ...(c?.cost?.runPerHead ?? {}) } },
    updatedAt: c?.updatedAt,
  };
}
