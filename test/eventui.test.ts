// 0.62: Battle Events, what the player sees (card and report block).
import { expect, test } from "bun:test";
import * as C from "../src/config";
import { bevCardHtml, bevReportHtml } from "../src/eventui";
import type { BevEvent } from "../src/events";

const ev = (over: Partial<BevEvent> = {}): BevEvent => ({ kind: "mayor", state: "live", people: [1, 2, 3], lead: 1, building: -1, x: 10, y: 10,
  alertT: 100, endT: 340, reached: false, frac: 0, title: "Mayor Ann Lee is sheltering with 2 aides", place: "", ...over });

test("live card: title, place, goal, countdown m:ss, Go there", () => {
  const h = bevCardHtml(ev(), 100 + 65, "Elm Street");
  expect(h).toContain("Mayor Ann Lee is sheltering with 2 aides");
  expect(h).toContain("Elm Street");
  expect(h).toContain("Reach them with a ground unit");
  expect(h).toContain("2:55");
  expect(h).toContain('data-bev="go"');
});

test("reached: the card says they are on their way", () => {
  expect(bevCardHtml(ev({ reached: true }), 200, "")).toMatch(/on their way|walking out/i);
});

test("power card runs until the round ends", () => {
  const h = bevCardHtml(ev({ kind: "power", endT: null, title: "The power station must keep running: its crew of 6 is staying" }), 200, "Mill Road");
  expect(h).toContain("until the round ends");
});

test("won and lost cards show the outcome", () => {
  expect(bevCardHtml(ev({ state: "won", frac: 1 }), 400, "")).toContain("+4 score");
  expect(bevCardHtml(ev({ state: "lost" }), 400, "")).toContain("-5 score");
});

test("titles are escaped", () => {
  expect(bevCardHtml(ev({ title: "<b>x</b>" }), 150, "<i>")).not.toContain("<b>x</b>");
});

test("report block: one row per event with what it was worth; empty without events", () => {
  expect(bevReportHtml([])).toBe("");
  const h = bevReportHtml([
    { kind: "mayor", won: true, frac: 1, score: 4, cash: 4_000_000, xp: 120, title: "Mayor Ann Lee is sheltering with 2 aides" },
    { kind: "research", won: false, frac: 0.25, score: -5, cash: 0, xp: 0, title: "Dr. Bo Kim's research team (4) needs to get out" },
  ]);
  expect(h).toContain("Battle events");
  expect(h).toContain("+4 score, $4.0M, +120 XP");
  expect(h).toContain("-5 score");
  expect(h).toContain("Dr. Bo Kim");
});

test("0.62.1: the card's points follow the config (mods)", () => {
  const [getS, setS] = C.TUNABLE.EVENT_SCORE, [getF, setF] = C.TUNABLE.EVENT_FAIL_SCORE, s0 = getS(), f0 = getF();
  try {
    setS(7); setF(9);
    expect(bevCardHtml(ev({ state: "won", frac: 1 }), 400, "")).toContain("+7 score");
    expect(bevCardHtml(ev({ state: "lost" }), 400, "")).toContain("-9 score");
  } finally { setS(s0); setF(f0); }
});
