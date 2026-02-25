import "dotenv/config";
import OpenAI from "openai";
import { VectorStore } from "./rag.js";
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
  const store = new VectorStore(openai);

  console.log("[startup] Initializing knowledge base...");
  const chunkCount = await store.init();
  console.log(`[startup] Knowledge base ready (${chunkCount} chunks indexed)`);

  // ─── Configuration ────────────────────────────────────

  const port = parseInt(process.env.PORT ?? "4100");
  const host = process.env.HOST ?? "0.0.0.0";
  const agentUrl = process.env.AGENT_URL ?? `http://localhost:${port}`;

  const server = createServer({
    port,
    host,
    agentUrl,
    agentMint: process.env.AGENT_NFT_MINT || undefined,
    store,
  });

  // ─── Start ────────────────────────────────────────────

  await server.start();

  // ─── Graceful Shutdown ────────────────────────────────

  const shutdown = () => {
    console.log("\nShutting down oracle agent...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
