export type AgentRunType = "prompt" | "naming";

export type AgentRunOutcome =
  | "completed"
  | "failed"
  | "aborted"
  | "max_rounds";

export type AgentTurnKind = "main" | "compaction" | "naming";

export type AgentTurnOutcome = "completed" | "error" | "aborted";

export type AgentToolOutcome = "success" | "error" | "cancelled";

export type AgentToolCategory =
  | "shell"
  | "patch"
  | "image"
  | "meta"
  | "other";

export type AgentFirstTokenKind = "text" | "thinking" | "toolCall";

export type AgentRunStarted = {
  runId: string;
  sessionId: string;
  runType: AgentRunType;
  startedAtMs: number;
  provider?: string;
  model?: string;
  permission?: string;
  promptChars?: number;
  promptHash?: string;
  historyMessagesAtStart?: number;
  contextWindow?: number;
  contextTokensStart?: number;
  maxRounds?: number;
  reasoningLevel?: string;
  systemPromptHash?: string;
  toolsetHash?: string;
  toolCount?: number;
  lastHeartbeatMs?: number;
};

export type AgentRunFinished = {
  endedAtMs: number;
  durationMs: number;
  outcome: AgentRunOutcome;
  provider?: string;
  model?: string;
  activeDurationMs?: number;
  errorStage?: string;
  errorCode?: string;
  errorMessage?: string;
  contextTokensEnd?: number;
  contextUtilizationEnd?: number;
  llmTurns: number;
  toolCalls: number;
  agentSteps: number;
  maxRoundsHit?: boolean;
  injectedPrompts?: number;
  toolErrors?: number;
  repeatToolCalls?: number;
  permissionRequests?: number;
  permissionWaitMs?: number;
  compactions?: number;
  compactionDurationMs?: number;
  compactionInputTokens?: number;
  compactionOutputTokens?: number;
  llmDurationMs?: number;
  toolDurationMs?: number;
  toolExecutionMs?: number;
  unaccountedMs?: number;
  ttftMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  tokensPerSecond?: number;
  wallTokensPerSecond?: number;
  finalStopReason?: string;
  toolSequenceJson?: string;
  submitToFirstTokenMs?: number;
  llmHttpAttempts?: number;
  llmRetries?: number;
  rateLimitResponses?: number;
  retryAfterMs?: number;
  providerHttpStatus?: number;
  lastHeartbeatMs?: number;
};

export type AgentTurnStarted = {
  turnId: string;
  sessionId: string;
  runId: string;
  turnKind: AgentTurnKind;
  startedAtMs: number;
  turnIndex?: number;
  provider?: string;
  model?: string;
  messageCount?: number;
  contextTokensBefore?: number;
};

export type AgentTurnFinished = {
  endedAtMs: number;
  durationMs: number;
  outcome: AgentTurnOutcome;
  ttftMs?: number;
  firstTokenKind?: AgentFirstTokenKind;
  generationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  tokensPerSecond?: number;
  wallTokensPerSecond?: number;
  stopReason?: string;
  responseId?: string;
  responseModel?: string;
  toolCalls?: number;
  contextTokensAfter?: number;
  receivedTextChars?: number;
  receivedThinkingChars?: number;
  llmHttpAttempts?: number;
  llmRetries?: number;
  rateLimitResponses?: number;
  retryAfterMs?: number;
  providerHttpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type AgentToolStarted = {
  toolSpanId: string;
  sessionId: string;
  runId: string;
  stepIndex: number;
  toolName: string;
  toolCategory: AgentToolCategory;
  startedAtMs: number;
  turnId?: string;
  turnIndex?: number;
  toolCallId?: string;
  argsBytes?: number;
  argsHash?: string;
  detail?: Record<string, unknown>;
};

export type AgentToolFinished = {
  endedAtMs: number;
  durationMs: number;
  outcome: AgentToolOutcome;
  permissionRequests?: number;
  permissionWaitMs?: number;
  executionMs?: number;
  isError?: boolean;
  endReason?: string;
  errorCode?: string;
  errorMessage?: string;
  outputChars?: number;
  outputBytes?: number;
  truncated?: boolean;
  imageCount?: number;
  repeatIndex?: number;
  repeatGroupSize?: number;
  detail?: Record<string, unknown>;
};

export type AgentEvent = {
  tsMs: number;
  event: string;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  toolSpanId?: string;
  detail?: Record<string, unknown>;
};

export type AgentObserverStats = {
  writeErrors: number;
  droppedWrites: number;
};

export interface AgentObserver {
  runStarted(run: AgentRunStarted): void;
  runFinished(runId: string, run: AgentRunFinished): void;
  turnStarted(turn: AgentTurnStarted): void;
  turnFinished(turnId: string, turn: AgentTurnFinished): void;
  toolStarted(tool: AgentToolStarted): void;
  toolFinished(toolSpanId: string, tool: AgentToolFinished): void;
  heartbeat(runId: string, tsMs: number): void;
  event(event: AgentEvent): void;
  flush(timeoutMs?: number): Promise<void>;
  close(): void;
  stats(): AgentObserverStats;
}

export const noopAgentObserver: AgentObserver = {
  runStarted: () => undefined,
  runFinished: () => undefined,
  turnStarted: () => undefined,
  turnFinished: () => undefined,
  toolStarted: () => undefined,
  toolFinished: () => undefined,
  heartbeat: () => undefined,
  event: () => undefined,
  flush: async () => undefined,
  close: () => undefined,
  stats: () => ({ writeErrors: 0, droppedWrites: 0 })
};
