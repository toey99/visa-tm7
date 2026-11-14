import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCases, caseForSlip, customerMsgZh, isOpen, pendingListZh, searchCases, type D90Item } from "./types.ts";

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
    item({ id: "2", kind: "slip", name: "LI ZHONG", ts: T0 + 1000 }),
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
    item({ id: "3", kind: "slip", name: "SOMEONE ELSE", ts: T0 + 5000 }),
    item({ id: "4", kind: "slip", name: "UNREADABLE", linkTo: "2", ts: T0 + 6000 }),
    item({ id: "5", kind: "slip", name: "CHEN ZHITAO", linkTo: "-", ts: T0 + 7000 }),
  ]);
  assert.deepEqual(b.orphanSlips.map((s) => s.id), ["3", "5"]);
  assert.equal(b.cases[1].slip?.id, "4");
  assert.equal(b.cases[1].how, "manual");
  assert.ok(isOpen(b.cases[0]));
});

test("one misread letter still matches when only one open case is close", () => {
  const b = buildCases([
    item({ id: "1", name: "NGUYEN THI HOA" }),
    item({ id: "2", kind: "slip", name: "NGUYEN THI HQA", ts: T0 + 1000 }),
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
