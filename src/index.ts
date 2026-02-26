import "dotenv/config";
import OpenAI from "openai";
import { VectorStore } from "./rag.js";
import { Store } from "./store.js";
import { OracleAgentExecutor } from "./a2a-executor.js";
import { createServer } from "./server.js";

async function main() {
  // ─── Validate Environment ─────────────────────────────

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is required.");
    console.error("Copy .env.example to .env and fill in your API key.");
    process.exit(1);
  }

  // ─── Initialize RAG Vector Store ──────────────────────

  const openai = new OpenAI();
  const vectorStore = new VectorStore(openai);

  console.log("[startup] Initializing knowledge base...");
  const chunkCount = await vectorStore.init();
  console.log(`[startup] Knowledge base ready (${chunkCount} chunks indexed)`);

  // ─── Initialize Session Store ─────────────────────────

  const sessionStore = new Store();

  // ─── Create Executor ──────────────────────────────────

  const executor = new OracleAgentExecutor(vectorStore, sessionStore);

  // ─── Configuration ────────────────────────────────────

  const port = parseInt(process.env.PORT ?? "4100");
  const host = process.env.HOST ?? "0.0.0.0";
  const agentUrl = process.env.AGENT_URL ?? `http://localhost:${port}`;
  const basePath = process.env.BASE_PATH ?? "";

  const server = createServer({
    port,
    host,
    agentUrl,
    basePath,
    agentMint: process.env.AGENT_MINT || process.env.AGENT_NFT_MINT || undefined,
    executor,
  });

  // ─── Start ────────────────────────────────────────────

  await server.start();

  // ─── Graceful Shutdown ────────────────────────────────

  const shutdown = () => {
    console.log("\nShutting down oracle agent...");
    sessionStore.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
