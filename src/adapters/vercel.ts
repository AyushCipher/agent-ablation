import type { Finding } from "../index.js";

/**
 * Structural representation of a step or tool execution result in Vercel AI SDK / Agent runs.
 */
export interface AISDKStepResult {
  /** Tool name or agent step identifier */
  toolName?: string;
  stepType?: string;
  /** Result or args */
  args?: unknown;
  result?: unknown;
  /** Token usage metadata if available */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Execution latency in ms */
  latencyMs?: number;
  [key: string]: unknown;
}

export interface AISDKAdapterOptions<TStep extends AISDKStepResult = AISDKStepResult> {
  /** Custom extractor for agent ID / tool name */
  agentIdOf?: (step: TStep) => string;
  /** Extractor for score */
  scoreOf: (step: TStep) => number;
  /** Optional confidence extractor */
  confidenceOf?: (step: TStep) => number | undefined;
  /** Optional cost extractor */
  costOf?: (step: TStep) => number | undefined;
}

/**
 * Converts Vercel AI SDK tool call steps or agent trace steps into `Finding[]` objects.
 */
export function fromAISDKSteps<TStep extends AISDKStepResult = AISDKStepResult>(
  steps: readonly TStep[] | TStep[],
  options: AISDKAdapterOptions<TStep>
): Finding[] {
  const findings: Finding[] = [];

  for (const step of steps) {
    if (!step || typeof step !== "object") continue;

    const agentId = options.agentIdOf ? options.agentIdOf(step) : step.toolName || step.stepType;
    if (!agentId || agentId.trim().length === 0) continue;

    const score = options.scoreOf(step);
    const confidence = options.confidenceOf ? options.confidenceOf(step) : undefined;
    const tokens = step.usage?.totalTokens ?? (
      (step.usage?.promptTokens || 0) + (step.usage?.completionTokens || 0) || undefined
    );
    const cost = options.costOf ? options.costOf(step) : undefined;
    const latencyMs = typeof step.latencyMs === "number" ? step.latencyMs : undefined;

    let metadata: Record<string, unknown> = {};
    if (typeof step.result === "object" && step.result !== null && !Array.isArray(step.result)) {
      metadata = { ...(step.result as Record<string, unknown>) };
    } else if (step.result !== undefined) {
      metadata = { result: step.result };
    }

    if (step.args) {
      metadata.args = step.args;
    }

    const finding: Finding = {
      agentId: agentId.trim(),
      score,
      metadata,
    };

    if (confidence !== undefined) finding.confidence = confidence;
    if (tokens !== undefined) finding.tokens = tokens;
    if (cost !== undefined) finding.cost = cost;
    if (latencyMs !== undefined) finding.latencyMs = latencyMs;

    findings.push(finding);
  }

  return findings;
}
