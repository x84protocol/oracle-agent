# x84 Protocol Oracle Agent

An AI agent that serves as the definitive expert on the [x84 protocol](https://x84.ai) — the infrastructure layer for the AI agent economy on Solana. Built with [`@openai/agents`](https://github.com/openai/openai-agents-js) and served via the [A2A (Agent-to-Agent) protocol](https://google.github.io/A2A/).

> **x84** was founded by [@johnnymcware](https://x.com/johnnymcware).

## What It Does

The Oracle Agent knows everything about x84:

- **Protocol mechanics** — 23 on-chain instructions, 9 PDA types, 47 error codes, settlement modes, delegation system, reputation model
- **SDK usage** — `@x84-ai/sdk` with instruction builders, PDA derivation, account fetchers, settlement, events, errors, and REST API client
- **Architecture** — Anchor/Rust program, NestJS backend, LangGraph runtime, Metaplex Core NFTs
- **Vision & ecosystem** — Infrastructure layer for the autonomous agent economy, revenue model, build phases, A2A + x402 protocols

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       A2A Protocol                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  GET  /.well-known/agent-card.json     → Discovery     │  │
│  │  POST /a2a (message/send)              → Sync          │  │
│  │  POST /a2a (message/stream)            → SSE Streaming │  │
│  │  POST /a2a (tasks/get)                 → Query Task    │  │
│  │  POST /a2a (tasks/cancel)              → Cancel Task   │  │
│  │  GET  /health                          → Status        │  │
│  └────────────────────────────────────────────────────────┘  │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              @openai/agents Agent                      │  │
│  │  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌────────────┐   │  │
│  │  │  lookup  │ │ lookup  │ │ lookup │ │  request   │   │  │
│  │  │_protocol │ │  _sdk   │ │  _faq  │ │_clarific.  │   │  │
│  │  └────┬─────┘ └────┬────┘ └───┬────┘ └─────┬──────┘   │  │
│  │       └─────────────┼─────────┘             │          │  │
│  │                     ↓                       ↓          │  │
│  │  ┌──────────────────────────────┐   sets task state    │  │
│  │  │  RAG Vector Store            │   to input-required  │  │
│  │  │  text-embedding-3-small      │                      │  │
│  │  │  cache: .cache/embeddings    │                      │  │
│  │  │  source: prompts/*.md        │                      │  │
│  │  └──────────────────────────────┘                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  SQLite Store (.data/oracle.db)                        │  │
│  │  ┌──────────────────┐  ┌────────────────────────────┐  │  │
│  │  │ sessions         │  │ tasks                      │  │  │
│  │  │ contextId →      │  │ id, contextId, state,      │  │  │
│  │  │ lastResponseId   │  │ artifacts, timestamps      │  │  │
│  │  └──────────────────┘  └────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Key Features

### RAG (Retrieval-Augmented Generation)

Markdown knowledge files are chunked by headings, embedded with `text-embedding-3-small`, and cached locally. Each tool call performs cosine-similarity search to retrieve only the most relevant chunks.

### Task Lifecycle (A2A-compliant)

Every message creates a **task** that progresses through states:

```
submitted → working → completed
                    → input-required → (user replies) → working → completed
                    → failed
                    → canceled
```

- **`input-required`** — The agent calls `request_clarification` when it needs more info. The next message on the same `contextId` resumes the same task instead of creating a new one.
- **`canceled`** — Clients can cancel in-flight tasks via `tasks/cancel`.
- Tasks are persisted to SQLite and survive server restarts.

### Conversation Continuity

Sessions map `contextId` → `lastResponseId` (OpenAI's native response chaining). Multi-turn conversations maintain full context across messages. Sessions are persisted to SQLite.

### Interactive CLI Client

A companion CLI at [`../oracle-cli/`](../oracle-cli/) provides an interactive chat interface with streaming, task tracking, cancellation (`Ctrl+C`), and `/history` & `/task` commands.

## Quick Start

### Prerequisites

- Node.js >= 22.5 (uses built-in `node:sqlite`)
- pnpm
- An OpenAI API key

### Setup

```bash
cd examples/oracle-agent

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### Run

```bash
# Development (with hot reload)
pnpm dev

# Production
pnpm start
```

The server starts on `http://localhost:4100` by default.

### Test with CLI

```bash
# In another terminal
cd examples/oracle-cli
pnpm install
pnpm start
```

### Test with curl

```bash
# Health check
curl http://localhost:4100/health

# Discover the agent
curl http://localhost:4100/.well-known/agent-card.json

# Ask a question (sync)
curl -X POST http://localhost:4100/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "What is x84?" }]
      }
    }
  }'

# Stream a response (SSE)
curl -N -X POST http://localhost:4100/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "message/stream",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "Show me how to register an agent using the SDK" }]
      }
    }
  }'

# Multi-turn conversation (pass contextId)
curl -X POST http://localhost:4100/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "message/send",
    "params": {
      "contextId": "my-session-1",
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "What is delegation?" }]
      }
    }
  }'

# Follow-up on same context (agent remembers previous messages)
curl -X POST http://localhost:4100/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "message/send",
    "params": {
      "contextId": "my-session-1",
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "How many permission flags does it have?" }]
      }
    }
  }'

# Get a task by ID
curl -X POST http://localhost:4100/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tasks/get",
    "params": { "id": "TASK_ID_HERE" }
  }'
```

## Project Structure

```
oracle-agent/
├── src/
│   ├── index.ts        # Entry point — init RAG store, start server
│   ├── server.ts       # Express A2A server, task lifecycle, SSE streaming
│   ├── agent.ts        # @openai/agents Agent configuration
│   ├── tools.ts        # 4 tools: 3 RAG search + request_clarification
│   ├── rag.ts          # Vector store: chunking, embedding, caching, search
│   └── store.ts        # SQLite store (sessions + tasks) via node:sqlite
├── prompts/
│   ├── system.md       # System prompt (identity, behavior, clarification rules)
│   ├── protocol.md     # Full protocol technical reference
│   ├── sdk-guide.md    # @x84-ai/sdk developer reference
│   └── faq.md          # Frequently asked questions
├── .cache/             # Auto-generated embedding cache (gitignored)
├── .data/              # SQLite database (gitignored)
├── .env.example        # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4.1` | Model to use |
| `PORT` | No | `4100` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `AGENT_URL` | No | `http://localhost:{PORT}` | Public URL (for Agent Card) |
| `AGENT_NFT_MINT` | No | — | Solana NFT mint (for x-x84 Agent Card extension) |

## A2A Protocol

This server implements the [A2A (Agent-to-Agent) protocol](https://google.github.io/A2A/):

| Endpoint | HTTP | Description |
|---|---|---|
| `/.well-known/agent-card.json` | GET | Agent discovery — capabilities, skills, metadata |
| `/a2a` | POST | JSON-RPC endpoint for all A2A methods |
| `/health` | GET | Health check |

### Supported A2A Methods

| Method | Alias | Description |
|---|---|---|
| `message/send` | `tasks/send` | Synchronous request → response |
| `message/stream` | `tasks/sendSubscribe` | SSE streaming with real-time deltas |
| `tasks/get` | — | Query task by ID (any state) |
| `tasks/cancel` | — | Cancel an in-flight or input-required task |

### SSE Event Types

During `message/stream`, the server emits these events:

| Event `kind` | When | Description |
|---|---|---|
| `status-update` (working) | Start | Task is being processed |
| `artifact-update` | Streaming | Text delta (append to response) |
| `status-update` (completed) | End | Task finished successfully |
| `status-update` (input-required) | End | Agent needs more info from user |
| `status-update` (failed) | Error | Task failed with error message |
| `status-update` (canceled) | Cancel | Task was canceled by client |
| `task` | Final | Full task object with all artifacts |
| `[DONE]` | Close | Stream end marker |

### Task States

```
submitted        Task created, queued for processing
working          Agent is generating a response
input-required   Agent needs clarification — reply to continue this task
completed        Response delivered successfully
failed           Error during processing
canceled         Canceled by client
```

## Extending the Knowledge Base

The agent's knowledge lives in markdown files under `prompts/`. To update:

1. Edit the relevant `.md` file in `prompts/`
2. Delete `.cache/` to force re-embedding
3. Restart the server

To add a new knowledge domain:

1. Create a new `.md` file in `prompts/`
2. Add a new RAG tool in `src/tools.ts`
3. The tool is automatically picked up by the agent

## How It Works

### Startup

1. Markdown files in `prompts/` are split into chunks by `##` headings (large sections split further by `###`)
2. Each chunk is embedded with `text-embedding-3-small` in a batch API call
3. Embeddings are cached to `.cache/` with a SHA-256 hash of source files
4. SQLite store is initialized — existing sessions and tasks are restored from `.data/oracle.db`

### Per Request

1. **A2A request** arrives at `POST /a2a` with a JSON-RPC message
2. **Task resolution** — if contextId has an `input-required` task, it's resumed; otherwise a new task is created
3. **Session lookup** — `previousResponseId` is fetched from SQLite for conversation continuity
4. **Agent execution** — `@openai/agents run()` with the user's question + conversation context
5. **Tool calls** — the LLM decides which tools to invoke:
   - `lookup_protocol` / `lookup_sdk` / `lookup_faq` — RAG search (top 5 chunks by cosine similarity)
   - `request_clarification` — signals the agent needs more info (sets task to `input-required`)
6. **Response** — synthesized with protocol details and code examples
7. **Task state** — updated to `completed` or `input-required` and persisted to SQLite
8. **Delivery** — returned as A2A task (sync) or streamed via SSE with real-time deltas

## About x84

x84 is the settlement layer for the autonomous agent economy on Solana. Every agent is a Metaplex Core NFT. Transfer the NFT = transfer the agent + reputation + revenue stream.

- **Website**: [x84.ai](https://x84.ai)
- **Program ID**: `X84XXXZsWXpanM5UzshMKZH4wUbeFNcxPWnFyTBgRP5`
- **Founder**: [@johnnymcware](https://x.com/johnnymcware)

## License

MIT
