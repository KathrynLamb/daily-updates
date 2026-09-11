import { test } from "node:test";
import assert from "node:assert/strict";
import { sourcesAreCurrent } from "./source-freshness.js";

const painting = {
  id: "observation-1",
  child_id: "demo-ava",
  observation_date: "2026-09-10",
  category: "activity",
  text: "Painted with sponges.",
};

const food = {
  ...painting,
  id: "observation-2",
  category: "food",
  text: "Ate some pasta.",
};

test("identical sources in a different order remain current", () => {
  assert.equal(
    sourcesAreCurrent([painting, food], [food, painting]),
    true
  );
});

test("an edited observation makes the snapshot stale", () => {
  assert.equal(
    sourcesAreCurrent([food], [{ ...food, text: "Ate all her pasta." }]),
    false
  );
});

test("an added observation makes the snapshot stale", () => {
  assert.equal(sourcesAreCurrent([painting], [painting, food]), false);
});

test("a deleted observation makes the snapshot stale", () => {
  assert.equal(sourcesAreCurrent([painting, food], [painting]), false);
});

test("malformed source data is rejected", () => {
  assert.throws(() => sourcesAreCurrent([painting], [{}]));
});