import type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import { run } from "@openai/agents";
import { createOracleAgent } from "./agent.js";
import type { VectorStore } from "./rag.js";
import { Store } from "./store.js";
import {
  extractText,
  publishInitialTask,
  publishStatus,
  publishFailure,
  publishArtifact,
  publishCanceled,
} from "./a2a-helpers.js";

export class OracleAgentExecutor implements AgentExecutor {
  private vectorStore: VectorStore;
  private sessionStore: Store;

  constructor(vectorStore: VectorStore, sessionStore: Store) {
    this.vectorStore = vectorStore;
    this.sessionStore = sessionStore;
  }

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage } = context;
    const userText = extractText(userMessage);

    if (!userText) {
      publishFailure(eventBus, taskId, contextId, "Empty message text");
      eventBus.finished();
      return;
    }

    publishInitialTask(context, eventBus);
    publishStatus(eventBus, taskId, contextId, "working");

    try {
      // Track whether the agent requests clarification from the user
      let inputRequired = false;

      const agent = createOracleAgent(this.vectorStore, (_question: string) => {
        inputRequired = true;
      });

      // Retrieve previous response ID for multi-turn conversation continuity
      const previousResponseId = this.sessionStore.getSession(contextId);

      const result = await run(agent, userText, { previousResponseId });

      const output = result.finalOutput ?? "I was unable to generate a response.";

      // Persist the response ID for future turns in this context
      if (result.lastResponseId) {
        this.sessionStore.setSession(contextId, result.lastResponseId);
      }

      // Publish the response artifact
      publishArtifact(eventBus, taskId, contextId, "response", output);

      // Resolve final state based on whether the agent requested clarification
      if (inputRequired) {
        publishStatus(eventBus, taskId, contextId, "input-required", "Waiting for user input");
      } else {
        publishStatus(eventBus, taskId, contextId, "completed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      publishFailure(eventBus, taskId, contextId, msg);
    }

    eventBus.finished();
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    publishCanceled(eventBus, taskId);
  }
}
