// Regression test for the passport issue/expiry day transposition:
// the two dates' DAY boxes sit on different printed lines than their
// own month/year, and they were once mapped to each other's slot.
//
// Run with: npm test
process.env.TZ = "Asia/Bangkok";

import assert from "node:assert/strict";
import test from "node:test";
import { passportDateFields, type Tm7TextField } from "./tm7-passport-dates.ts";

// Parsed exactly the way the generators parse the ISO payload.
const parse = (iso: string) => new Date(iso);

function byKey(fields: Tm7TextField[]): Record<string, Tm7TextField> {
  return Object.fromEntries(fields.map((f) => [f.key, f]));
}

test("issue 2024-11-20 and expiry 2034-11-19 keep their own day/month/year", () => {
  const f = byKey(passportDateFields(parse("2024-11-20"), parse("2034-11-19")));

  // Date of issue — 20 NOVEMBER 2024
  assert.equal(f["p1.issueDay"].value, "20");
  assert.equal(f["p1.issueMonth"].value, "NOVEMBER");
  assert.equal(f["p1.issueYear"].value, "2024");

  // Valid until — 19 NOVEMBER 2034
  assert.equal(f["p1.expDay"].value, "19");
  assert.equal(f["p1.expMonth"].value, "NOVEMBER");
  assert.equal(f["p1.expYear"].value, "2034");
});

test("each day lands in its own slot on the form", () => {
  const f = byKey(passportDateFields(parse("2024-11-20"), parse("2034-11-19")));

  // Issue day ends the passport-number line (y 478); its month/year are
  // one line below (y 436) — where the expiry day also lives.
  assert.deepEqual({ x: f["p1.issueDay"].x, y: f["p1.issueDay"].y }, { x: 480, y: 478 });
  assert.deepEqual({ x: f["p1.issueMonth"].x, y: f["p1.issueMonth"].y }, { x: 105, y: 436 });
  assert.deepEqual({ x: f["p1.issueYear"].x, y: f["p1.issueYear"].y }, { x: 205, y: 436 });

  assert.deepEqual({ x: f["p1.expDay"].x, y: f["p1.expDay"].y }, { x: 480, y: 436 });
  assert.deepEqual({ x: f["p1.expMonth"].x, y: f["p1.expMonth"].y }, { x: 105, y: 406 });
  assert.deepEqual({ x: f["p1.expYear"].x, y: f["p1.expYear"].y }, { x: 205, y: 406 });

  // No two fields may share a slot.
  const slots = Object.values(f).map((v) => `${v.x},${v.y}`);
  assert.equal(new Set(slots).size, slots.length);
});

test("dates with different days are never cross-assigned", () => {
  // Day-only difference: a swap is invisible in month/year, so assert days.
  const f = byKey(passportDateFields(parse("2019-01-03"), parse("2029-01-28")));
  assert.equal(f["p1.issueDay"].value, "3");
  assert.equal(f["p1.expDay"].value, "28");
});

test("a missing date contributes no fields", () => {
  const onlyIssue = passportDateFields(parse("2024-11-20"), null);
  assert.deepEqual(onlyIssue.map((x) => x.key), ["p1.issueDay", "p1.issueMonth", "p1.issueYear"]);

  const onlyExpiry = passportDateFields(null, parse("2034-11-19"));
  assert.deepEqual(onlyExpiry.map((x) => x.key), ["p1.expDay", "p1.expMonth", "p1.expYear"]);

  assert.deepEqual(passportDateFields(null, null), []);
});
