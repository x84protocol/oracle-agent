import { tool } from "@openai/agents";
import { z } from "zod";
import type { VectorStore } from "./rag.js";

// Callback the server provides to signal input-required state.
export type InputRequiredCallback = (question: string) => void;

/**
 * Create the oracle's RAG-powered tools.
 *
 * Each tool performs a semantic search against the vector store
 * and returns only the most relevant chunks — not the entire knowledge base.
 *
 * The `onInputRequired` callback lets the agent signal it needs more info
 * from the user before it can complete the task.
 */
export function createTools(store: VectorStore, onInputRequired?: InputRequiredCallback) {
  const lookupProtocol = tool({
    name: "lookup_protocol",
    description:
      "Search x84 protocol technical details: instructions, PDAs, error codes, " +
      "enums, mechanics, architecture, constants, revenue model, settlement, delegation. " +
      "Use this when answering questions about how the on-chain program works.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Natural language search query, e.g. 'how does verify_and_settle work', " +
          "'AgentIdentity PDA fields', 'delegation depth and owner_version'",
        ),
    }),
    execute: async ({ query }) => {
      const results = await store.search(query, 5);
      if (results.length === 0) {
        return "No relevant protocol information found for this query.";
      }
      return results
        .map(
          (r, i) =>
            `--- Result ${i + 1} (score: ${r.score.toFixed(3)}) [${r.chunk.source}] ${r.chunk.heading} ---\n${r.chunk.content}`,
        )
        .join("\n\n");
    },
  });

  const lookupSdk = tool({
    name: "lookup_sdk",
    description:
      "Search x84 SDK usage: @x84-ai/sdk — instructions, PDA helpers, account fetchers, " +
      "settlement builders, DelegationBuilder, API client, events, errors, and utilities. " +
      "Use this when answering 'how do I...' developer questions.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Natural language search query, e.g. 'register an agent', " +
          "'DelegationBuilder usage', 'x402 Express middleware setup'",
        ),
    }),
    execute: async ({ query }) => {
      const results = await store.search(`SDK ${query}`, 5);
      if (results.length === 0) {
        return "No relevant SDK information found for this query.";
      }
      return results
        .map(
          (r, i) =>
            `--- Result ${i + 1} (score: ${r.score.toFixed(3)}) [${r.chunk.source}] ${r.chunk.heading} ---\n${r.chunk.content}`,
        )
        .join("\n\n");
    },
  });

  const lookupFaq = tool({
    name: "lookup_faq",
    description:
      "Search frequently asked questions about x84: general overview, agents & NFTs, " +
      "payments, delegation, A2A protocol, SDK, build phases, founder, vision. " +
      "Use this for high-level or conceptual questions.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Natural language search query, e.g. 'what is x84', " +
          "'who founded x84', 'how does x402 payment work'",
        ),
    }),
    execute: async ({ query }) => {
      const results = await store.search(`FAQ ${query}`, 5);
      if (results.length === 0) {
        return "No relevant FAQ information found for this query.";
      }
      return results
        .map(
          (r, i) =>
            `--- Result ${i + 1} (score: ${r.score.toFixed(3)}) [${r.chunk.source}] ${r.chunk.heading} ---\n${r.chunk.content}`,
        )
        .join("\n\n");
    },
  });

  const requestClarification = tool({
    name: "request_clarification",
    description:
      "Call this when you need more information from the user before you can " +
      "provide a complete or accurate answer. For example, if the question is " +
      "ambiguous, too broad, or missing critical context. Pass the clarifying " +
      "question you want to ask the user.",
    parameters: z.object({
      question: z
        .string()
        .describe("The clarifying question to ask the user"),
    }),
    execute: async ({ question }) => {
      onInputRequired?.(question);
      return `[AWAITING_USER_INPUT] You have asked the user: "${question}". Stop here and present this question to the user. Do not attempt to answer without their response.`;
    },
  });

  return [lookupProtocol, lookupSdk, lookupFaq, requestClarification];
}
