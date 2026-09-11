import { z } from "zod";

const sourcesSchema = z.array(
  z.strictObject({
    id: z.string(),
    child_id: z.string(),
    observation_date: z.iso.date(),
    category: z.string(),
    text: z.string(),
  })
);

function canonicalSources(value: unknown): string {
  const sources = sourcesSchema.parse(value);

  const sorted = sources.sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify(
    sorted.map((source) => [
      source.id,
      source.child_id,
      source.observation_date,
      source.category,
      source.text,
    ])
  );
}

export function sourcesAreCurrent(
  snapshot: unknown,
  current: unknown
): boolean {
  return canonicalSources(snapshot) === canonicalSources(current);
}