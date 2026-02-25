import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(__dirname, "../prompts");
const cacheDir = resolve(__dirname, "../.cache");
const cachePath = resolve(cacheDir, "embeddings.json");

const EMBEDDING_MODEL = "text-embedding-3-small";
const TOP_K = 5;

// ─── Types ──────────────────────────────────────────────────

interface Chunk {
  id: string;
  source: string;
  heading: string;
  content: string;
}

interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

interface CacheFile {
  sourceHash: string;
  model: string;
  chunks: EmbeddedChunk[];
}

// ─── Chunker ────────────────────────────────────────────────

/**
 * Split a markdown file into chunks by ## headings.
 * Each chunk includes the heading and all content until the next heading.
 * Nested ### headings stay grouped under their parent ##.
 */
function chunkMarkdown(source: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split("\n");

  let currentHeading = "Introduction";
  let currentLines: string[] = [];

  for (const line of lines) {
    // Split on ## but not ### (we want ### to stay grouped under ##)
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      // Flush previous chunk
      if (currentLines.length > 0) {
        const text = currentLines.join("\n").trim();
        if (text.length > 50) {
          chunks.push({
            id: `${source}:${chunks.length}`,
            source,
            heading: currentHeading,
            content: text,
          });
        }
      }
      currentHeading = line.replace(/^##\s+/, "").trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last chunk
  if (currentLines.length > 0) {
    const text = currentLines.join("\n").trim();
    if (text.length > 50) {
      chunks.push({
        id: `${source}:${chunks.length}`,
        source,
        heading: currentHeading,
        content: text,
      });
    }
  }

  // If any chunk is very large (>3000 chars), split by ### headings too
  const refined: Chunk[] = [];
  for (const chunk of chunks) {
    if (chunk.content.length > 3000) {
      const subChunks = splitBySubheadings(chunk);
      refined.push(...subChunks);
    } else {
      refined.push(chunk);
    }
  }

  return refined;
}

function splitBySubheadings(chunk: Chunk): Chunk[] {
  const lines = chunk.content.split("\n");
  const subChunks: Chunk[] = [];
  let currentHeading = chunk.heading;
  let currentLines: string[] = [];
  let idx = 0;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (currentLines.length > 0) {
        const text = currentLines.join("\n").trim();
        if (text.length > 50) {
          subChunks.push({
            id: `${chunk.source}:${chunk.id}:${idx++}`,
            source: chunk.source,
            heading: currentHeading,
            content: text,
          });
        }
      }
      currentHeading = `${chunk.heading} > ${line.replace(/^###\s+/, "").trim()}`;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const text = currentLines.join("\n").trim();
    if (text.length > 50) {
      subChunks.push({
        id: `${chunk.source}:${chunk.id}:${idx}`,
        source: chunk.source,
        heading: currentHeading,
        content: text,
      });
    }
  }

  return subChunks.length > 0 ? subChunks : [chunk];
}

// ─── Embeddings ─────────────────────────────────────────────

async function embedTexts(
  openai: OpenAI,
  texts: string[],
): Promise<number[][]> {
  // OpenAI supports batch embedding up to 2048 inputs
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ─── Cosine Similarity ─────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Source Hash ────────────────────────────────────────────

const KNOWLEDGE_FILES = ["protocol.md", "sdk-guide.md", "faq.md"];

function computeSourceHash(): string {
  const hash = createHash("sha256");
  for (const file of KNOWLEDGE_FILES) {
    const content = readFileSync(resolve(promptsDir, file), "utf-8");
    hash.update(content);
  }
  return hash.digest("hex");
}

// ─── Vector Store ───────────────────────────────────────────

export class VectorStore {
  private chunks: EmbeddedChunk[] = [];
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  /**
   * Initialize the store: load from cache or build from scratch.
   * Returns the number of chunks indexed.
   */
  async init(): Promise<number> {
    const sourceHash = computeSourceHash();

    // Try loading from cache
    if (existsSync(cachePath)) {
      try {
        const cache: CacheFile = JSON.parse(
          readFileSync(cachePath, "utf-8"),
        );
        if (
          cache.sourceHash === sourceHash &&
          cache.model === EMBEDDING_MODEL
        ) {
          this.chunks = cache.chunks;
          console.log(
            `[rag] Loaded ${this.chunks.length} chunks from cache`,
          );
          return this.chunks.length;
        }
        console.log("[rag] Source files changed, rebuilding embeddings...");
      } catch {
        console.log("[rag] Cache corrupted, rebuilding...");
      }
    } else {
      console.log("[rag] No cache found, building embeddings...");
    }

    // Build from scratch
    const allChunks: Chunk[] = [];
    for (const file of KNOWLEDGE_FILES) {
      const content = readFileSync(resolve(promptsDir, file), "utf-8");
      const chunks = chunkMarkdown(file, content);
      allChunks.push(...chunks);
    }

    console.log(
      `[rag] Chunked ${KNOWLEDGE_FILES.length} files into ${allChunks.length} chunks`,
    );

    // Embed all chunks in a single batch
    const texts = allChunks.map(
      (c) => `[${c.source}] ${c.heading}\n\n${c.content}`,
    );
    console.log(`[rag] Embedding ${texts.length} chunks with ${EMBEDDING_MODEL}...`);
    const embeddings = await embedTexts(this.openai, texts);

    this.chunks = allChunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i],
    }));

    // Persist to cache
    mkdirSync(cacheDir, { recursive: true });
    const cache: CacheFile = {
      sourceHash,
      model: EMBEDDING_MODEL,
      chunks: this.chunks,
    };
    writeFileSync(cachePath, JSON.stringify(cache));
    console.log(`[rag] Cached ${this.chunks.length} embeddings to .cache/`);

    return this.chunks.length;
  }

  /**
   * Semantic search: embed the query and return top-k most relevant chunks.
   */
  async search(
    query: string,
    topK: number = TOP_K,
  ): Promise<Array<{ chunk: Chunk; score: number }>> {
    const [queryEmbedding] = await embedTexts(this.openai, [query]);

    const scored = this.chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
