import { v4 as uuidv4 } from "uuid";
import type {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from "@a2a-js/sdk";
import type {
  ExecutionEventBus,
  RequestContext,
} from "@a2a-js/sdk/server";

export function extractText(message: Message): string {
  const textPart = message.parts.find((p) => p.kind === "text");
  return textPart && "text" in textPart ? textPart.text : "";
}

export function publishInitialTask(
  context: RequestContext,
  eventBus: ExecutionEventBus,
): void {
  if (context.task) return;

  eventBus.publish({
    kind: "task",
    id: context.taskId,
    contextId: context.contextId,
    status: { state: "submitted", timestamp: new Date().toISOString() },
    history: [context.userMessage],
  } as Task);
}

export function publishStatus(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  state: "working" | "completed" | "input-required",
  message?: string,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId,
    status: {
      state,
      timestamp: new Date().toISOString(),
      ...(message
        ? {
            message: {
              kind: "message",
              messageId: uuidv4(),
              role: "agent",
              parts: [{ kind: "text", text: message }],
            },
          }
        : {}),
    },
    final: state === "completed" || state === "input-required",
  } as TaskStatusUpdateEvent);
}

export function publishFailure(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  text: string,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId,
    status: {
      state: "failed",
      timestamp: new Date().toISOString(),
      message: {
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ kind: "text", text }],
      },
    },
    final: true,
  } as TaskStatusUpdateEvent);
}

export function publishArtifact(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  name: string,
  text: string,
): void {
  eventBus.publish({
    kind: "artifact-update",
    taskId,
    contextId,
    artifact: {
      artifactId: uuidv4(),
      name,
      parts: [{ kind: "text", text }],
    },
    lastChunk: true,
  } as TaskArtifactUpdateEvent);
}

export function publishCanceled(
  eventBus: ExecutionEventBus,
  taskId: string,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId: "",
    status: { state: "canceled", timestamp: new Date().toISOString() },
    final: true,
  } as TaskStatusUpdateEvent);
  eventBus.finished();
}
