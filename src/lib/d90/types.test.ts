import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCases, caseForSlip, daySummary, isOldSlip, returnSummary, summaryDay, summaryRequest, customerMsgZh, isOpen, pendingListZh, searchCases, type D90Item } from "./types.ts";

const T0 = Date.UTC(2026, 10, 14, 2, 0, 0); // 14 Nov 2026 09:00 Bangkok
const item = (p: Partial<D90Item> & { id: string }): D90Item => ({
  ts: T0, kind: "passport", img: "", groupId: "G", name: "", passportNo: "", nationality: "", nextDue: "", ...p,
});

test("slip closes the passport case with the same name, any word order or spacing", () => {
  const b = buildCases([
    item({ id: "1", name: "LI ZHONG", passportNo: "E11111111" }),
    item({ id: "2", name: "YANG LIFENG", ts: T0 + 1000 }),
    item({ id: "3", kind: "slip", name: "ZHONG LI ( MALE )", nextDue: "12/02/2027", ts: T0 + 60_000 }),
    item({ id: "4", kind: "slip", name: "MR. YANG LI FENG", nextDue: "12/02/2027", ts: T0 + 61_000 }),
  ]);
  assert.equal(b.cases[0].slip?.id, "3");
  assert.equal(b.cases[1].slip?.id, "4");
  assert.equal(b.orphanSlips.length, 0);
  assert.equal(b.cases.filter(isOpen).length, 0);
});

test("a slip never closes a case that arrived after it, and a repeat customer opens a new case", () => {
  const b = buildCases([
    item({ id: "1", name: "LI ZHONG" }),
    item({ id: "2", kind: "slip", name: "LI ZHONG", nextDue: "12/02/2027", ts: T0 + 1000 }),
    item({ id: "3", name: "LI ZHONG", ts: T0 + 90 * 86400000 }),
  ]);
  assert.equal(b.cases[0].slip?.id, "2");
  assert.equal(b.cases[1].slip, null);
  assert.ok(isOpen(b.cases[1]));
});

test("unknown slip stays unmatched; a hand link wins; '-' keeps it unmatched", () => {
  const b = buildCases([
    item({ id: "1", name: "CHEN ZHITAO" }),
    item({ id: "2", name: "WANG JIANGPING", ts: T0 + 1 }),
    item({ id: "3", kind: "slip", name: "SOMEONE ELSE", nextDue: "12/02/2027", ts: T0 + 5000 }),
    item({ id: "4", kind: "slip", name: "UNREADABLE", linkTo: "2", ts: T0 + 6000 }),
    item({ id: "5", kind: "slip", name: "CHEN ZHITAO", nextDue: "12/02/2027", linkTo: "-", ts: T0 + 7000 }),
  ]);
  assert.deepEqual(b.orphanSlips.map((s) => s.id), ["3", "5"]);
  assert.equal(b.cases[1].slip?.id, "4");
  assert.equal(b.cases[1].how, "manual");
  assert.ok(isOpen(b.cases[0]));
});

test("one misread letter still matches when only one open case is close", () => {
  const b = buildCases([
    item({ id: "1", name: "NGUYEN THI HOA" }),
    item({ id: "2", kind: "slip", name: "NGUYEN THI HQA", nextDue: "12/02/2027", ts: T0 + 1000 }),
  ]);
  assert.equal(b.cases[0].slip?.id, "2");
  assert.equal(b.cases[0].how, "fuzzy");
});

test("extra pages attach to the passport sent just before them", () => {
  const b = buildCases([
    item({ id: "1", name: "A B" }),
    item({ id: "2", kind: "other", ts: T0 + 2000 }),
    item({ id: "3", name: "C D", ts: T0 + 3000 }),
    item({ id: "4", kind: "other", ts: T0 + 4000 }),
    item({ id: "5", kind: "other", ts: T0 + 3600_000 }),
  ]);
  assert.deepEqual(b.cases[0].pages.map((p) => p.id), ["2"]);
  assert.deepEqual(b.cases[1].pages.map((p) => p.id), ["4"]);
  assert.deepEqual(b.loose.map((p) => p.id), ["5"]);
});

test("pending list groups by Bangkok day; search finds by partial name or passport no.", () => {
  const b = buildCases([
    item({ id: "1", name: "LI ZHONG", passportNo: "E12345678" }),
    item({ id: "2", name: "PANG CHONG", ts: T0 + 86400000, done: true }),
    item({ id: "3", name: "MARIAENI", ts: T0 + 86400000 }),
  ]);
  assert.equal(pendingListZh(b), "90天报道 · 待出单 2 人\n\n11月14日提交\nLI ZHONG\n\n11月15日提交\nMARIAENI");
  assert.equal(searchCases(b, "zhong")[0].passport.id, "1");
  assert.equal(searchCases(b, "345678")[0].passport.id, "1");
  assert.equal(searchCases(b, "nobody").length, 0);
});

test("Chinese name: shown beside the English one, searchable, and carried into the customer reminder", () => {
  const items = [
    item({ id: "1", name: "YANG LIFENG", cn: "杨立峰" }),
    item({ id: "2", name: "NGUYEN THI HOA", ts: T0 + 1 }),
    item({ id: "3", kind: "slip", name: "YANG LIFENG", nextDue: "01/02/2027", ts: T0 + 5000 }),
  ];
  const b = buildCases(items);
  assert.equal(searchCases(b, "立峰")[0].passport.id, "1");
  assert.equal(searchCases(b, "王").length, 0);
  assert.equal(pendingListZh(b), "90天报道 · 待出单 1 人\n\n11月14日提交\nNGUYEN THI HOA");
  const c = caseForSlip(items, "3");
  assert.equal(c?.passport.cn, "杨立峰");
  assert.equal(customerMsgZh(c!.passport.name, c!.passport.cn, "01/02/2027"), "YANG LIFENG 杨立峰\n提醒您下一次的泰国90天报到 (90-day report)\n日期是：2027年02月01日。");
  assert.equal(customerMsgZh("NGUYEN THI HOA", "", ""), "NGUYEN THI HOA\n提醒您下一次的泰国90天报到 (90-day report)\n日期：请见回执单。");
});

test("the previous slip sent in with the job never closes it; the new one (due ~90 days out) does", () => {
  const items = [
    item({ id: "1", name: "LI ZHONG", cn: "李忠" }),
    item({ id: "2", kind: "other", ts: T0 + 1000 }),                                               // entry stamp
    item({ id: "3", kind: "slip", name: "LI ZHONG", nextDue: "20/11/2026", ts: T0 + 2000 }),       // previous slip, due next week
    item({ id: "4", kind: "slip", name: "LI ZHONG", nextDue: "12/02/2027", ts: T0 + 86400000 }),   // result, a day later
  ];
  assert.equal(isOldSlip(items[2], items), true);
  assert.equal(isOldSlip(items[3], items), false);
  const open = buildCases(items.slice(0, 3));
  assert.ok(isOpen(open.cases[0]));
  assert.deepEqual(open.cases[0].pages.map((p) => p.id), ["2", "3"]);
  assert.equal(caseForSlip(items.slice(0, 3), "3"), undefined);
  const done = buildCases(items);
  assert.equal(done.cases[0].slip?.id, "4");
  assert.equal(done.orphanSlips.length, 0);
});

test("unreadable date: a slip in the passport's batch is the previous one, a later one is the result; a hand mark overrides both", () => {
  const p = item({ id: "1", name: "MARIAENI" });
  const inBatch = item({ id: "2", kind: "slip", name: "MARIAENI", ts: T0 + 5000 });
  const later = item({ id: "3", kind: "slip", name: "MARIAENI", ts: T0 + 3600_000 });
  assert.equal(isOldSlip(inBatch, [p, inBatch]), true);
  assert.equal(isOldSlip(later, [p, later]), false);
  assert.equal(buildCases([p, { ...inBatch, old: false }]).cases[0].slip?.id, "2");
  const forced = buildCases([p, { ...later, nextDue: "12/02/2027", old: true }]);
  assert.ok(isOpen(forced.cases[0]));
  assert.deepEqual(forced.cases[0].pages.map((x) => x.id), ["3"]);
});

test("pages sent BEFORE their passport still land on it", () => {
  // one customer: stamp, visa, then the passport
  const one = buildCases([
    item({ id: "1", kind: "other", ts: T0 }),
    item({ id: "2", kind: "other", ts: T0 + 1000 }),
    item({ id: "3", name: "LI ZHONG", ts: T0 + 2000 }),
  ]);
  assert.deepEqual(one.cases[0].pages.map((p) => p.id), ["1", "2"]);
  assert.equal(one.loose.length, 0);

  // two customers forwarded together, each as stamp → passport → visa
  const two = buildCases([
    item({ id: "1", kind: "other", ts: T0 }),
    item({ id: "2", name: "A B", ts: T0 + 1000 }),
    item({ id: "3", kind: "other", ts: T0 + 2000 }),
    item({ id: "4", kind: "other", ts: T0 + 3000 }),
    item({ id: "5", name: "C D", ts: T0 + 4000 }),
    item({ id: "6", kind: "other", ts: T0 + 5000 }),
  ]);
  assert.deepEqual(two.cases[0].pages.map((p) => p.id), ["1", "3"]);
  assert.deepEqual(two.cases[1].pages.map((p) => p.id), ["4", "6"]);
});

test("a visa page that shows the passport number goes to that passport wherever it sits; hand moves win", () => {
  const items = [
    item({ id: "1", name: "A B", passportNo: "E11111111", ts: T0 }),
    item({ id: "2", name: "C D", passportNo: "E22222222", ts: T0 + 1000 }),
    item({ id: "3", kind: "other", passportNo: "E11111111", ts: T0 + 2000 }),  // A B's visa, sent after C D's passport
    item({ id: "4", kind: "other", ts: T0 + 3000 }),
  ];
  const b = buildCases(items);
  assert.deepEqual(b.cases[0].pages.map((p) => p.id), ["3"]);
  assert.deepEqual(b.cases[1].pages.map((p) => p.id), ["4"]);
  const moved = buildCases([...items.slice(0, 3), { ...items[3], linkTo: "1" }]);
  assert.deepEqual(moved.cases[0].pages.map((p) => p.id), ["3", "4"]);
  const cut = buildCases([...items.slice(0, 3), { ...items[3], linkTo: "-" }]);
  assert.deepEqual(cut.loose.map((p) => p.id), ["4"]);
});

test("day summary: numbered English + Chinese name + passport no., for the day asked", () => {
  const b = buildCases([
    item({ id: "1", name: "LI ZHONG", cn: "李忠", passportNo: "AA236515" }),
    item({ id: "2", name: "NGUYEN THI HOA", passportNo: "BA1515215", ts: T0 + 3600_000 }),
    item({ id: "3", name: "WANG JIANGPING", cn: "王江平", passportNo: "SA51515151", ts: T0 + 86400000 }),
  ]);
  assert.equal(daySummary(b, "2026-11-14"),
    "📥 รับงาน 90 วัน · 14 พ.ย. 2026 · 2 คน\n90天报到 · 11月14日 · 共2人\n\n1. LI ZHONG 李忠 AA236515\n2. NGUYEN THI HOA BA1515215");
  assert.equal(summaryDay("สรุป", T0), "2026-11-14");
  assert.equal(summaryDay("สรุป เมื่อวาน", T0), "2026-11-13");
  assert.equal(summaryDay("สรุป 9", T0), "2026-11-09");
  assert.equal(summaryDay("สรุป 30/10", T0), "2026-10-30");
  assert.equal(summaryDay("สรุป 28/12", T0), "2025-12-28");
  assert.equal(summaryDay("?li zhong", T0), null);
});

test("return summary: jobs whose new slip came back that day, with the next report date; unmatched slips flagged", () => {
  const D = 86400000;
  const b = buildCases([
    item({ id: "1", name: "LI ZHONG", cn: "李忠", passportNo: "AA236515" }),
    item({ id: "2", name: "NGUYEN THI HOA", passportNo: "BA1515215", ts: T0 + 1000 }),
    item({ id: "3", name: "WANG JIANGPING", cn: "王江平", ts: T0 + 2000 }),
    item({ id: "4", kind: "slip", name: "LI ZHONG", nextDue: "12/02/2027", ts: T0 + D }),
    item({ id: "5", kind: "slip", name: "NGUYEN THI HOA", nextDue: "12/02/2027", ts: T0 + D + 1000 }),
    item({ id: "6", kind: "slip", name: "SOMEBODY NEW", nextDue: "12/02/2027", ts: T0 + D + 2000 }),
  ]);
  assert.equal(returnSummary(b, "2026-11-15"),
    "✅ ส่งงาน 90 วัน · 15 พ.ย. 2026 · 2 คน\n90天报到已完成 · 11月15日 · 共2人\n\n" +
    "1. LI ZHONG 李忠 AA236515 · 下次报到 2027年02月12日\n2. NGUYEN THI HOA BA1515215 · 下次报到 2027年02月12日\n\n" +
    "⚠️ ใบที่ยังไม่จับคู่ 1 ใบ (ยังไม่นับ): SOMEBODY NEW");
  assert.equal(returnSummary(b, "2026-11-14"), "✅ ส่งงาน 90 วัน · 14 พ.ย. 2026 · 0 คน\n90天报到已完成 · 11月14日 · 共0人");
  assert.deepEqual(summaryRequest("สรุปส่ง", T0), { type: "out", day: "2026-11-14" });
  assert.deepEqual(summaryRequest("สรุปส่งงาน เมื่อวาน", T0), { type: "out", day: "2026-11-13" });
  assert.deepEqual(summaryRequest("สรุป ส่ง 9/11", T0), { type: "out", day: "2026-11-09" });
  assert.deepEqual(summaryRequest("สรุป", T0), { type: "in", day: "2026-11-14" });
  assert.deepEqual(summaryRequest("สรุป 13", T0), { type: "in", day: "2026-11-13" });
  assert.equal(summaryRequest("ขอบคุณค่ะ", T0), null);
});
