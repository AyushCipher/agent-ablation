import type { Finding } from "../index.js";

/**
 * Structural representation of a task output or message produced by a CrewAI agent.
 */
export interface CrewAITaskOutput {
  /** The role or name of the agent that performed the task. */
  agent?: string | { role?: string; name?: string } | null;
  /** Raw string or structured output of the task. */
  raw?: string;
  /** Optional structured JSON / object output if configured with output_json/pydantic. */
  json_dict?: Record<string, unknown> | null;
  /** Optional numerical score or rating if present on the output. */
  score?: number;
  /** Optional tokens, cost or execution time telemetry. */
  cost?: number;
  tokens?: number;
  latencyMs?: number;
  /** Arbitrary metadata. */
  [key: string]: unknown;
}

export interface CrewAIAdapterOptions<TOutput extends CrewAITaskOutput = CrewAITaskOutput> {
  /** Custom extractor for score if not directly in output.score */
  scoreOf?: (output: TOutput) => number;
  /** Custom extractor for agent name if not in output.agent */
  agentIdOf?: (output: TOutput) => string;
  /** Custom confidence extractor */
  confidenceOf?: (output: TOutput) => number | undefined;
  /** Cost extractor */
  costOf?: (output: TOutput) => number | undefined;
  /** Tokens extractor */
  tokensOf?: (output: TOutput) => number | undefined;
}

/**
 * Converts CrewAI task outputs or agent payloads into `Finding[]` objects.
 */
export function fromCrewAITasks<TOutput extends CrewAITaskOutput = CrewAITaskOutput>(
  outputs: readonly TOutput[] | TOutput[],
  options: CrewAIAdapterOptions<TOutput> = {}
): Finding[] {
  const findings: Finding[] = [];

  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;

    let agentId: string | undefined;
    if (options.agentIdOf) {
      agentId = options.agentIdOf(output);
    } else if (typeof output.agent === "string") {
      agentId = output.agent;
    } else if (typeof output.agent === "object" && output.agent !== null) {
      agentId = output.agent.role || output.agent.name;
    }

    if (!agentId || agentId.trim().length === 0) continue;

    let score = 0;
    if (options.scoreOf) {
      score = options.scoreOf(output);
    } else if (typeof output.score === "number") {
      score = output.score;
    } else if (output.json_dict && typeof output.json_dict.score === "number") {
      score = output.json_dict.score;
    }

    const confidence = options.confidenceOf
      ? options.confidenceOf(output)
      : output.json_dict && typeof output.json_dict.confidence === "number"
      ? (output.json_dict.confidence as number)
      : undefined;

    const cost = options.costOf ? options.costOf(output) : typeof output.cost === "number" ? output.cost : undefined;
    const tokens = options.tokensOf ? options.tokensOf(output) : typeof output.tokens === "number" ? output.tokens : undefined;
    const latencyMs = typeof output.latencyMs === "number" ? output.latencyMs : undefined;

    const metadata: Record<string, unknown> = {
      ...(output.json_dict || {}),
      ...(output.raw ? { raw: output.raw } : {}),
    };

    const finding: Finding = {
      agentId: agentId.trim(),
      score,
      metadata,
    };

    if (confidence !== undefined) finding.confidence = confidence;
    if (cost !== undefined) finding.cost = cost;
    if (tokens !== undefined) finding.tokens = tokens;
    if (latencyMs !== undefined) finding.latencyMs = latencyMs;

    findings.push(finding);
  }

  return findings;
}
