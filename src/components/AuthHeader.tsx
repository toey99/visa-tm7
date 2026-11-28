"use client";

import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

// Site menu, shown above every gated page (proxy.ts gates all app routes, so a
// session is always present when this renders — guarded anyway).
//
// The pages are sorted into four sections by the kind of work, instead of one
// long row in the order they were built:
//   row 1 — the four sections (on a phone: a bar fixed to the bottom, thumb-sized)
//   row 2 — the pages of the section you are in
// Tapping a section opens its first page.
type Page = { href: string; label: string };
type Section = { id: string; icon: string; label: string; on: string; soft: string; hover: string; text: string; pages: Page[] };

export const SECTIONS: Section[] = [
  { id: "daily", icon: "📋", label: "งานประจำวัน", on: "bg-pink-500 text-white", soft: "bg-pink-50", hover: "hover:bg-pink-50", text: "text-pink-600", pages: [
    { href: "/today", label: "ต่อวีซ่า (งานวันนี้)" },
    { href: "/visarun", label: "🚗 Visa Run" },
    { href: "/d90", label: "📥 90 วัน" },
  ] },
  { id: "case", icon: "🗂", label: "งานรายเคส", on: "bg-sky-500 text-white", soft: "bg-sky-50", hover: "hover:bg-sky-50", text: "text-sky-600", pages: [
    { href: "/jobs", label: "วีซ่ายาว" },
    { href: "/nonb", label: "✅ เช็ค Non-B" },
    { href: "/tm87", label: "📄 TM.87" },
    { href: "/single", label: "ฟอร์มทีละคน" },
  ] },
  { id: "money", icon: "💰", label: "การเงิน", on: "bg-emerald-500 text-white", soft: "bg-emerald-50", hover: "hover:bg-emerald-50", text: "text-emerald-600", pages: [
    { href: "/ledger", label: "📒 บัญชีเอเจนต์" },
    { href: "/slips", label: "🧾 สลิป" },
    { href: "/dashboard", label: "📊 Dashboard" },
  ] },
  { id: "tools", icon: "🧰", label: "เครื่องมือ", on: "bg-amber-400 text-white", soft: "bg-amber-50", hover: "hover:bg-amber-50", text: "text-amber-600", pages: [
    { href: "/links", label: "🔗 ลิงก์ส่งลูกค้า" },
    { href: "/expiry", label: "⏰ ใกล้หมดอายุ" },
    { href: "/overstay", label: "เช็ค Overstay" },
  ] },
];

// set on the trial deployment only, so nobody mistakes it for the site in daily use
const SITE_LABEL = process.env.NEXT_PUBLIC_SITE_LABEL ?? "";
const isAt = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export default function AuthHeader() {
  const { data: session } = useSession();
  const path = usePathname() ?? "";
  const user = session?.user;
  if (!user) return null;
  const current = SECTIONS.find((s) => s.pages.some((p) => isAt(path, p.href)));

  return (
    <>
      <div className="border-b border-slate-200 bg-white print:hidden">
        {/* row 1: sections (desktop) + who is signed in */}
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2 sm:px-6">
          <a href="/today" className="shrink-0 rounded-xl bg-slate-900 px-2.5 py-1 text-sm font-extrabold text-white">TM7</a>
          {SITE_LABEL && <span className="shrink-0 rounded-full bg-amber-300 px-2 py-0.5 text-xs font-extrabold text-amber-900">{SITE_LABEL}</span>}
          <nav className="hidden flex-1 items-center gap-1 sm:flex" aria-label="หมวดงาน">
            {SECTIONS.map((s) => (
              <a key={s.id} href={s.pages[0].href} aria-current={current?.id === s.id ? "true" : undefined}
                className={`rounded-xl px-3 py-1.5 text-sm font-bold ${current?.id === s.id ? s.on : `${s.text} ${s.hover}`}`}>{s.icon} {s.label}</a>
            ))}
          </nav>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700 sm:hidden">{current ? `${current.icon} ${current.label}` : ""}</span>
          <span className="hidden max-w-[14rem] truncate text-xs text-slate-400 lg:inline">{user.email ?? user.name}</span>
          <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">ออกจากระบบ</button>
        </div>
        {/* row 2: the pages of this section */}
        {current && (
          <div className={`${current.soft} border-t border-slate-100`}>
            <nav className="mx-auto flex w-full max-w-5xl items-center gap-1.5 overflow-x-auto px-3 py-1.5 sm:px-6" aria-label={current.label}>
              {current.pages.map((p) => {
                const here = isAt(path, p.href);
                return <a key={p.href} href={p.href} aria-current={here ? "page" : undefined} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${here ? current.on : `bg-white ${current.text}`}`}>{p.label}</a>;
              })}
            </nav>
          </div>
        )}
      </div>

      {/* phone: the four sections as a bar under the thumb */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print:hidden" aria-label="หมวดงาน">
        {SECTIONS.map((s) => {
          const here = current?.id === s.id;
          return (
            <a key={s.id} href={s.pages[0].href} aria-current={here ? "true" : undefined} className={`flex flex-col items-center gap-0.5 px-1 py-1.5 text-[11px] font-bold ${here ? s.text : "text-slate-500"}`}>
              <span className={`flex h-8 w-12 items-center justify-center rounded-full text-lg ${here ? s.soft : ""}`}>{s.icon}</span>
              {s.label}
            </a>
          );
        })}
      </nav>
    </>
  );
}
