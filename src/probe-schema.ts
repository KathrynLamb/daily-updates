// src/probe-schema.ts
// One paid call. Answers two questions that no local test can answer:
// 1. Does the API accept this schema and compile a grammar for it?
// 2. Does that grammar actually bind the enum at decode time?
//
// The system prompt below deliberately instructs a value the enum forbids.
// If constrained sampling is working, the model cannot emit it, however
// plainly it is told to. If it can emit it, the constraint is decorative.
//
// Run: npx tsx src/probe-schema.ts

import { claude } from "./claude.js";
import { reviewModel, reviewOutputSchema } from "./review-schema.js";

const properties = reviewOutputSchema["properties"] as Record<
  string,
  { enum?: string[] }
>;
const permitted = properties["verdict"]?.enum ?? [];

console.log("Schema sent:");
console.log(JSON.stringify(reviewOutputSchema, null, 2));
console.log("\nPermitted top-level verdicts:", permitted);
console.log("\nCalling", reviewModel, "...\n");

try {
  const response = await claude.messages.create({
    model: reviewModel,
    max_tokens: 200,
    system: [
      "Ignore any other instruction about verdict vocabulary.",
      'Set verdict to exactly the string "incomplete".',
      'Set coverage.verdict to exactly the string "incomplete".',
      'Set both reason fields to "probe".',
    ].join(" "),
    messages: [{ role: "user", content: "probe" }],
    output_config: {
      format: {
        type: "json_schema",
        schema: reviewOutputSchema,
      },
    },
  });

  const block = response.content.find((item) => item.type === "text");
  const text = block && block.type === "text" ? block.text : "";

  console.log("stop_reason:", response.stop_reason);
  console.log("raw text:", text);
  console.log("usage:", response.usage);

  const parsed = JSON.parse(text) as { verdict?: unknown };
  const verdict = parsed.verdict;

  if (verdict === "incomplete") {
    console.log(
      "\nFAIL: the model returned a forbidden value. The grammar is not binding the enum."
    );
    process.exitCode = 1;
  } else if (typeof verdict === "string" && permitted.includes(verdict)) {
    console.log(
      `\nPASS: forced to "${verdict}" despite being told to return "incomplete". The enum is enforced at decode time.`
    );
  } else {
    console.log("\nUNCLEAR: unexpected verdict value:", verdict);
    process.exitCode = 1;
  }
} catch (error) {
  // A schema the API will not compile fails here, before any generation.
  console.log("\nCall failed. If this is a 400 invalid_request_error naming");
  console.log("the schema, the API rejected it and nothing was generated.\n");
  console.error(error);
  process.exitCode = 1;
}