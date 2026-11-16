import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanText,
  dayLabel,
  emptyState,
  layout,
  mergeState,
  ropePath,
  seedEcho,
  threadKey,
  tiePath,
  togglePin,
  untie,
  validateName,
} from "./model.js";

test("thread key is the same from both seats", () => {
  assert.equal(threadKey("ася", "марк"), threadKey("марк", "ася"));
  assert.equal(threadKey("ася", "echo"), "echo:ася");
  assert.equal(threadKey("ася", "self"), "self:ася");
});

test("names keep letters and reject the thread's own words", () => {
  assert.equal(validateName("  Ася  ").display, "Ася");
  assert.equal(validateName("эхо").ok, false);
  assert.equal(validateName("себе").ok, false);
  assert.equal(validateName("123").ok, false);
  assert.equal(validateName("").ok, false);
});

test("empty text is refused and long text is cut off at the reason", () => {
  assert.equal(cleanText("   \n").ok, false);
  assert.equal(cleanText("а".repeat(501)).ok, false);
  assert.equal(cleanText("  держи  \n\n\n\nнить ").text, "держи\n\nнить");
});

test("echo is seeded once per seat", () => {
  const once = seedEcho(emptyState(), "ася", Date.parse("2026-11-16T12:00:00Z"));
  const twice = seedEcho(once, "ася", Date.parse("2026-11-16T15:00:00Z"));
  assert.equal(twice.knots.length, 5);
  assert.ok(twice.knots.every((knot) => knot.thread === "echo:ася"));
  const other = seedEcho(twice, "марк", Date.parse("2026-11-16T15:00:00Z"));
  assert.equal(other.knots.length, 10);
});

test("merge keeps both knots, prefers the newer pin list, and honors untie", () => {
  const base = emptyState();
  const left = togglePin(
    {
      ...base,
      seats: { ася: "Ася" },
      knots: [
        { id: "a", thread: "pair:ася|марк", from: "ася", text: "раз", at: 1, replyTo: null },
      ],
    },
    "ася",
    "a",
  );
  const right = untie(
    {
      ...base,
      seats: { марк: "Марк" },
      contacts: { лена: "Лена" },
      knots: [
        { id: "a", thread: "pair:ася|марк", from: "ася", text: "раз", at: 1, replyTo: null },
        { id: "b", thread: "pair:ася|марк", from: "марк", text: "два", at: 2, replyTo: "a" },
      ],
    },
    "a",
  );
  const merged = mergeState(left, right);
  assert.deepEqual(
    merged.knots.map((knot) => knot.id),
    ["b"],
  );
  assert.deepEqual(merged.pins.ася, []);
  assert.equal(merged.seats.марк, "Марк");
  assert.equal(merged.contacts.лена, "Лена");
  assert.ok(merged.deleted.includes("a"));
  const resurrected = mergeState(merged, left);
  assert.deepEqual(
    resurrected.knots.map((knot) => knot.id),
    ["b"],
  );
});

test("layout walks left to right and leaves the loose end after the last knot", () => {
  const now = Date.parse("2026-11-16T12:00:00");
  const knots = [
    { id: "1", at: now - 86_400_000, thread: "t", from: "ася", text: "вчера", replyTo: null },
    { id: "2", at: now, thread: "t", from: "марк", text: "сегодня", replyTo: null },
  ];
  const placed = layout(knots, { now });
  const knotItems = placed.items.filter((item) => item.type === "knot");
  const days = placed.items.filter((item) => item.type === "day");
  assert.equal(days.length, 2);
  assert.ok(knotItems[1].x > knotItems[0].x);
  assert.ok(placed.composerX > knotItems[1].x);
  assert.equal(dayLabel(now, now), "16 ноября");
  assert.match(ropePath(placed.ropeXs, 200), /^M /);
  assert.match(tiePath(10, 40, 200, "me"), /Q/);
});
