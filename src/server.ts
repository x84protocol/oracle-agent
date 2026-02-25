import { run, setOpenAIAPI, setOpenAIResponsesTransport } from "@openai/agents";
import type { Request, Response } from "express";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import { createOracleAgent } from "./agent.js";
import type { VectorStore } from "./rag.js";
import { Store } from "./store.js";
import type { Task, TaskArtifact, TaskState } from "./store.js";

// ─── Types ──────────────────────────────────────────────────

interface A2AMessage {
  role: string;
  parts: Array<{ type: string; text?: string }>;
}

interface A2AJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: {
    message?: A2AMessage;
    contextId?: string;
    id?: string;
  };
}

interface AgentCardSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: AgentCardSkill[];
  "x-x84"?: {
    agentMint: string;
    paymentRequired: boolean;
    network: string;
  };
}

setOpenAIAPI("responses");
setOpenAIResponsesTransport("websocket");

// ─── Helpers ────────────────────────────────────────────────

function extractText(message: A2AMessage): string {
  return message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}

function taskToA2A(task: Task) {
  return {
    kind: "task" as const,
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    artifacts: task.artifacts,
  };
}

// ─── Server Factory ─────────────────────────────────────────

export interface ServerConfig {
  port: number;
  host: string;
  agentUrl: string;
  agentMint?: string;
  store: VectorStore;
}

export function createServer(config: ServerConfig): {
  app: express.Express;
  agentCard: AgentCard;
  start: () => Promise<void>;
} {
  const store = new Store();

  // Per-request flag: set by the request_clarification tool callback.
  // The agent is shared across requests, so we use a Map keyed by taskId.
  const inputRequiredFlags = new Map<string, boolean>();

  // Current taskId per execution — set before run(), read by tool callback.
  let activeRunTaskId: string | null = null;

  const agent = createOracleAgent(config.store, (_question: string) => {
    if (activeRunTaskId) {
      inputRequiredFlags.set(activeRunTaskId, true);
    }
  });

  // Track in-flight streaming tasks for cancellation
  const abortControllers = new Map<string, AbortController>();

  const agentCard: AgentCard = {
    name: "x84 Oracle",
    description:
      "The definitive AI expert on the x84 protocol. Ask anything about " +
      "on-chain instructions, PDAs, the SDK, payment settlement, delegation, " +
      "A2A protocol, and the x84 ecosystem. Founded by @johnnymcware.",
    url: config.agentUrl,
    version: "0.1.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      {
        id: "protocol-expert",
        name: "Protocol Expert",
        description:
          "Deep knowledge of x84's 23 on-chain instructions, 9 PDA types, " +
          "47 error codes, settlement mechanics, delegation system, and reputation model.",
        tags: ["x84", "solana", "protocol", "on-chain"],
        examples: [
          "How does verify_and_settle work?",
          "What are the 3 settlement modes?",
          "Explain the delegation depth system",
          "What happens when an agent NFT is transferred?",
        ],
      },
      {
        id: "sdk-guide",
        name: "SDK Developer Guide",
        description:
          "Provides code examples and guidance for @x84-ai/sdk — " +
          "identity, service, reputation, delegation, payment, and settlement instructions.",
        tags: ["sdk", "typescript", "developer", "code"],
        examples: [
          "How do I register an agent using the SDK?",
          "Show me how to set up the DelegationBuilder",
          "How do I set payment requirements for a service?",
          "How do I fetch all agents owned by a wallet?",
        ],
      },
      {
        id: "general-faq",
        name: "x84 FAQ & Vision",
        description:
          "Answers general questions about x84's vision, architecture, " +
          "revenue model, founder, build phases, and ecosystem.",
        tags: ["faq", "vision", "architecture"],
        examples: [
          "What is x84?",
          "Who founded x84?",
          "How does x84 make money?",
          "What's the tech stack?",
        ],
      },
    ],
  };

  if (config.agentMint) {
    agentCard["x-x84"] = {
      agentMint: config.agentMint,
      paymentRequired: false,
      network: "solana:devnet",
    };
  }

  const app = express();
  app.use(express.json());

  // ─── Health Check ───────────────────────────────────────

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      agent: "x84 Oracle",
      version: "0.1.0",
      uptime: process.uptime(),
    });
  });

  // ─── Agent Card (A2A Discovery) ────────────────────────

  app.get("/.well-known/agent-card.json", (_req: Request, res: Response) => {
    res.json(agentCard);
  });

  // ─── Helpers: resolve task for context ─────────────────

  /**
   * If the context has an active `input-required` task, reuse it.
   * Otherwise create a new task.
   */
  function resolveTask(contextId: string): { taskId: string; resumed: boolean } {
    const active = store.getActiveTask(contextId);
    if (active) {
      return { taskId: active.id, resumed: true };
    }
    const taskId = uuidv4();
    store.createTask(taskId, contextId);
    return { taskId, resumed: false };
  }

  /**
   * Determine final state after a run completes.
   */
  function resolveEndState(taskId: string): TaskState {
    const flagged = inputRequiredFlags.get(taskId);
    inputRequiredFlags.delete(taskId);
    return flagged ? "input-required" : "completed";
  }

  // ─── A2A JSON-RPC Endpoint ─────────────────────────────

  app.post("/a2a", async (req: Request, res: Response) => {
    try {
      const { method, params, id } = req.body as A2AJsonRpcRequest;

      // ── tasks/get ─────────────────────────────────────

      if (method === "tasks/get") {
        const taskId = params?.id;
        if (!taskId) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing task id in params" },
          });
          return;
        }

        const task = store.getTask(taskId);
        if (!task) {
          res.status(404).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: `Task not found: ${taskId}` },
          });
          return;
        }

        res.json({ jsonrpc: "2.0", id, result: taskToA2A(task) });
        return;
      }

      // ── tasks/cancel ──────────────────────────────────

      if (method === "tasks/cancel") {
        const taskId = params?.id;
        if (!taskId) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing task id in params" },
          });
          return;
        }

        const task = store.getTask(taskId);
        if (!task) {
          res.status(404).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: `Task not found: ${taskId}` },
          });
          return;
        }

        if (task.status.state === "completed" || task.status.state === "failed") {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32002,
              message: `Task already ${task.status.state}`,
            },
          });
          return;
        }

        const ac = abortControllers.get(taskId);
        if (ac) {
          ac.abort();
          abortControllers.delete(taskId);
        }

        store.updateTaskStatus(taskId, "canceled", "Canceled by client");
        const updated = store.getTask(taskId)!;
        res.json({ jsonrpc: "2.0", id, result: taskToA2A(updated) });
        return;
      }

      // ── message/send (synchronous) ──────────────────────

      if (method === "message/send" || method === "tasks/send") {
        const message = params?.message;
        if (!message) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing message in params" },
          });
          return;
        }

        const userText = extractText(message);
        if (!userText) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Empty message text" },
          });
          return;
        }

        const contextId = params.contextId ?? uuidv4();
        const { taskId, resumed } = resolveTask(contextId);
        const previousResponseId = store.getSession(contextId);

        store.updateTaskStatus(taskId, "working", resumed ? "Continuing..." : "Thinking...");

        try {
          activeRunTaskId = taskId;
          const result = await run(agent, userText, { previousResponseId });
          activeRunTaskId = null;

          const output =
            result.finalOutput ?? "I was unable to generate a response.";

          if (result.lastResponseId) {
            store.setSession(contextId, result.lastResponseId);
          }

          const endState = resolveEndState(taskId);
          const artifacts: TaskArtifact[] = [
            { name: "response", parts: [{ type: "text", text: output }] },
          ];
          store.setTaskArtifacts(taskId, artifacts);
          store.updateTaskStatus(taskId, endState);

          const task = store.getTask(taskId)!;
          res.json({ jsonrpc: "2.0", id, result: taskToA2A(task) });
        } catch (err) {
          activeRunTaskId = null;
          inputRequiredFlags.delete(taskId);
          store.updateTaskStatus(taskId, "failed", (err as Error).message);
          throw err;
        }
        return;
      }

      // ── message/stream (SSE) ────────────────────────────

      if (method === "message/stream" || method === "tasks/sendSubscribe") {
        const message = params?.message;
        if (!message) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing message in params" },
          });
          return;
        }

        const userText = extractText(message);
        if (!userText) {
          res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Empty message text" },
          });
          return;
        }

        // Set up SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const contextId = params.contextId ?? uuidv4();
        const { taskId, resumed } = resolveTask(contextId);
        const previousResponseId = store.getSession(contextId);

        // Set up abort controller for cancellation
        const ac = new AbortController();
        abortControllers.set(taskId, ac);

        const sendEvent = (data: Record<string, unknown>) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        };

        // Clear previous artifacts if resuming (agent will produce new response)
        if (resumed) {
          store.setTaskArtifacts(taskId, []);
        }

        // Transition: working
        const workingMsg = resumed ? "Continuing..." : "Thinking...";
        store.updateTaskStatus(taskId, "working", workingMsg);
        sendEvent({
          kind: "status-update",
          taskId,
          contextId,
          status: { state: "working", message: workingMsg },
        });

        try {
          activeRunTaskId = taskId;
          const result = await run(agent, userText, {
            stream: true,
            previousResponseId,
          });

          let fullText = "";

          for await (const event of result) {
            if (ac.signal.aborted) break;

            if (
              event.type === "raw_model_stream_event" &&
              event.data?.type === "model" &&
              event.data.event?.type === "response.output_text.delta"
            ) {
              const delta = (event.data.event as any).delta ?? "";
              fullText += delta;

              store.appendToTaskArtifact(taskId, delta);

              sendEvent({
                kind: "artifact-update",
                taskId,
                contextId,
                artifact: {
                  name: "response",
                  parts: [{ type: "text", text: delta }],
                  append: true,
                },
              });
            }
          }

          activeRunTaskId = null;

          // Handle cancellation
          if (ac.signal.aborted) {
            inputRequiredFlags.delete(taskId);
            store.updateTaskStatus(taskId, "canceled", "Canceled by client");
            sendEvent({
              kind: "status-update",
              taskId,
              contextId,
              status: { state: "canceled", message: "Canceled by client" },
            });
            sendEvent(taskToA2A(store.getTask(taskId)!));
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }

          // Fallback if streaming didn't capture text
          if (!fullText && result.finalOutput) {
            fullText = result.finalOutput;
            store.setTaskArtifacts(taskId, [
              { name: "response", parts: [{ type: "text", text: fullText }] },
            ]);
            sendEvent({
              kind: "artifact-update",
              taskId,
              contextId,
              artifact: {
                name: "response",
                parts: [{ type: "text", text: fullText }],
              },
            });
          }

          if (result.lastResponseId) {
            store.setSession(contextId, result.lastResponseId);
          }

          // Resolve final state: completed or input-required
          const endState = resolveEndState(taskId);
          store.updateTaskStatus(taskId, endState);

          sendEvent({
            kind: "status-update",
            taskId,
            contextId,
            status: {
              state: endState,
              ...(endState === "input-required"
                ? { message: "Waiting for user input" }
                : {}),
            },
          });

          sendEvent(taskToA2A(store.getTask(taskId)!));
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (err) {
          activeRunTaskId = null;
          inputRequiredFlags.delete(taskId);
          store.updateTaskStatus(taskId, "failed", (err as Error).message);
          sendEvent({
            kind: "status-update",
            taskId,
            contextId,
            status: { state: "failed", message: (err as Error).message },
          });
          sendEvent(taskToA2A(store.getTask(taskId)!));
          res.write("data: [DONE]\n\n");
          res.end();
        } finally {
          abortControllers.delete(taskId);
        }
        return;
      }

      // ── Unknown method ──────────────────────────────────

      res.status(400).json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      });
    } catch (err) {
      console.error("[oracle-agent] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id,
          error: {
            code: -32603,
            message: (err as Error).message,
          },
        });
      }
    }
  });

  return {
    app,
    agentCard,
    start: () =>
      new Promise<void>((resolve) => {
        app.listen(config.port, config.host, () => {
          console.log(`
┌─────────────────────────────────────────────────┐
│              x84 Protocol Oracle                │
│         powered by @openai/agents               │
├─────────────────────────────────────────────────┤
│  A2A Server:  ${config.agentUrl.padEnd(33)}│
│  Agent Card:  /.well-known/agent-card.json      │
│  A2A RPC:     POST /a2a                         │
│  Health:      GET /health                       │
│  Model:       ${(process.env.OPENAI_MODEL ?? "gpt-4.1").padEnd(33)}│
│  Store:       SQLite (.data/oracle.db)          │
└─────────────────────────────────────────────────┘
`);
          resolve();
        });
      }),
  };
}
