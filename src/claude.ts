import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is missing");
}

export const claude = new Anthropic({
  apiKey,
  timeout: 30_000,
  maxRetries: 0,
});