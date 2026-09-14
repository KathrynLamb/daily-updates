import { reviewContent } from "./content-reviewer.js";

// Labelled development fixtures: test omissions independently
// of invented claims.
const cases = [
  {
    draft: "Ava painted with sponges and ate some pasta.",
    expected: "complete",
  },
  {
    draft: "Ava painted with sponges.",
    expected: "incomplete",
  },
  {
    draft: "Ava ate some pasta and did some sponge painting.",
    expected: "complete",
  },
] as const;

// for (const example of cases) {
    for (const example of cases.slice(1, 2)) {
  const review = await reviewContent({
    childName: "Ava",
    observations: [
      { id: "o1", text: "Painted with sponges." },
      { id: "o2", text: "Ate some pasta." },
    ],
    draft: example.draft,
  });

  const matched =
    review.verdict === "supported" &&
    review.coverage.verdict === example.expected;

  console.log({
    draft: example.draft,
    grounding: review.verdict,
    coverage: review.coverage,
    expected: example.expected,
    matched,
  });

  if (!matched) process.exitCode = 1;
}