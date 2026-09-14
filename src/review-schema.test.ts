// src/review-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { reviewSchema, reviewOutputSchema } from "./review-schema.js";

// Walk a JSON Schema object, yielding every subschema.
function* subschemas(node: unknown): Generator<Record<string, unknown>> {
  if (typeof node !== "object" || node === null) return;
  const schema = node as Record<string, unknown>;
  yield schema;

  const properties = schema["properties"];
  if (typeof properties === "object" && properties !== null) {
    for (const child of Object.values(properties)) yield* subschemas(child);
  }

  const items = schema["items"];
  if (items !== undefined) yield* subschemas(items);

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      for (const child of branch) yield* subschemas(child);
    }
  }

  const defs = schema["$defs"];
  if (typeof defs === "object" && defs !== null) {
    for (const child of Object.values(defs)) yield* subschemas(child);
  }
}

function at(path: string[]): Record<string, unknown> {
  let node = reviewOutputSchema;
  for (const key of path) {
    const properties = node["properties"] as Record<string, unknown>;
    node = properties[key] as Record<string, unknown>;
  }
  return node;
}

test("the grounding verdict is sent as an enforced enum", () => {
  assert.deepEqual(at(["verdict"])["enum"], [
    "supported",
    "unsupported",
    "uncertain",
  ]);
});

// Coverage vocabulary is no longer in the model's hands at all. The schema
// must not offer it a verdict field to fill in.
test("the model is not asked for a coverage verdict", () => {
  const coverage = at(["coverage"]);
  const properties = coverage["properties"] as Record<string, unknown>;
  assert.equal("verdict" in properties, false);
  assert.deepEqual(
    Object.keys(properties).sort(),
    ["coveredObservationIds", "reason"]
  );
});

test("covered observation ids are sent as an array of strings", () => {
  const field = at(["coverage", "coveredObservationIds"]);
  assert.equal(field["type"], "array");
  assert.deepEqual(field["items"], { type: "string" });
});

// The specific failure this file exists to prevent: coverage vocabulary
// reaching the grounding verdict.
test("coverage values are not permitted in the grounding verdict", () => {
  const permitted = at(["verdict"])["enum"] as string[];
  assert.equal(permitted.includes("incomplete"), false);
  assert.equal(permitted.includes("complete"), false);
});

// zodOutputFormat and jsonSchemaOutputFormat demote unsupported keywords into
// a `description` blob. If a constraint reappears as prose, it is no longer
// enforced by constrained sampling, whatever the description says.
test("no constraint has been demoted into a description", () => {
  for (const schema of subschemas(reviewOutputSchema)) {
    const description = schema["description"];
    if (typeof description !== "string") continue;
    assert.equal(
      /\{\s*(enum|const|minItems|format|\$schema)\s*:/.test(description),
      false,
      `constraint found in description: ${description}`
    );
  }
});

// Parity: every enum in the Zod schema must survive into the wire schema with
// the same members. This is the axis the two contracts drifted apart on.
function zodEnums(schema: z.ZodType): Map<string, string[]> {
  const found = new Map<string, string[]>();

  function walk(node: z.ZodType, path: string[]) {
    const def = (node as unknown as { _zod: { def: Record<string, unknown> } })
      ._zod.def;

    if (def["type"] === "enum") {
      const entries = def["entries"] as Record<string, string>;
      found.set(path.join("."), Object.values(entries));
      return;
    }

    if (def["type"] === "object") {
      const shape = def["shape"] as Record<string, z.ZodType>;
      for (const [key, child] of Object.entries(shape)) {
        walk(child, [...path, key]);
      }
    }
  }

  walk(schema, []);
  return found;
}

test("every Zod enum survives into the wire schema", () => {
  const expected = zodEnums(reviewSchema);
  assert.ok(expected.size > 0, "no enums found in the Zod schema");

  for (const [path, values] of expected) {
    const node = at(path.split("."));
    assert.deepEqual(
      node["enum"],
      values,
      `enum missing or altered at ${path}`
    );
  }
});

// The wire schema must also stay inside the subset the API accepts.
test("every object is closed and fully required", () => {
  for (const schema of subschemas(reviewOutputSchema)) {
    if (schema["type"] !== "object") continue;
    assert.equal(schema["additionalProperties"], false);
    const properties = Object.keys(
      (schema["properties"] as Record<string, unknown>) ?? {}
    );
    assert.deepEqual(
      [...(schema["required"] as string[] ?? [])].sort(),
      [...properties].sort()
    );
  }
});

test("$schema is not sent", () => {
  assert.equal("$schema" in reviewOutputSchema, false);
});

// Local validation half of the contract.
test("Zod rejects a coverage value in the grounding verdict", () => {
  const result = reviewSchema.safeParse({
    verdict: "incomplete",
    reason: "One observation was omitted.",
    coverage: { coveredObservationIds: ["o1"], reason: "o2 is missing." },
  });
  assert.equal(result.success, false);
});