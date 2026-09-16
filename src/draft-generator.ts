// src/draft-generator.ts
//
// Asks Claude to write a draft from a child's observations. The route
// records the attempt and decides what happens to the result; this module
// only makes the call and validates the response.

import { claude } from "./claude.js";
import {
  generationModel,
  generationOutputSchema,
  generationPrompt,
  parseGenerationResponse,
  type GenerationInput,
  type GenerationResult,
} from "./generation-schema.js";

export type DraftGenerator = (
  input: GenerationInput
) => Promise<GenerationResult>;

export async function generateDraft(
  input: GenerationInput
): Promise<GenerationResult> {
  const response = await claude.messages.create({
    model: generationModel,
    max_tokens: 600,
    system: generationPrompt,
    messages: [
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
    // Sent verbatim, as with the reviewer: the SDK schema helpers
    // rewrite the schema before sending it.
    output_config: {
      format: {
        type: "json_schema",
        schema: generationOutputSchema,
      },
    },
  });

  return parseGenerationResponse(response);
}