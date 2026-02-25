import { Agent } from "@openai/agents";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTools } from "./tools.js";
import type { InputRequiredCallback } from "./tools.js";
import type { VectorStore } from "./rag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(__dirname, "../prompts");

function loadSystemPrompt(): string {
  return readFileSync(resolve(promptsDir, "system.md"), "utf-8");
}

/**
 * Create the x84 Oracle agent.
 *
 * Tools perform semantic search (RAG) against the vector store,
 * returning only the most relevant chunks for each query.
 *
 * `onInputRequired` is called when the agent decides it needs
 * more information from the user before completing a task.
 */
export function createOracleAgent(
  store: VectorStore,
  onInputRequired?: InputRequiredCallback,
): Agent {
  const instructions = loadSystemPrompt();
  const tools = createTools(store, onInputRequired);

  return new Agent({
    name: "x84 Oracle",
    instructions,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1",
    tools,
  });
}
