import type { Finding } from "../index.js";

/**
 * Structural representation of a message from an AutoGen multi-agent chat session.
 */
export interface AutoGenMessage {
  /** The name/role of the agent that authored the message. */
  name?: string | null;
  /** Content of the message, either string or object payload. */
  content?: unknown;
  /** Role string (e.g. "user", "assistant"). */
  role?: string | null;
  /** Optional metadata / context dictionary. */
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AutoGenAdapterOptions<TMessage extends AutoGenMessage = AutoGenMessage> {
  /** Extractor for numeric score / rating from the message. */
  scoreOf: (message: TMessage) => number;
  /** Optional extractor for confidence rating. */
  confidenceOf?: (message: TMessage) => number | undefined;
  /** Optional extractor for token usage. */
  tokensOf?: (message: TMessage) => number | undefined;
  /** Optional extractor for dollar cost. */
  costOf?: (message: TMessage) => number | undefined;
}

/**
 * Converts AutoGen conversation history into `Finding[]` objects.
 */
export function fromAutoGenMessages<TMessage extends AutoGenMessage = AutoGenMessage>(
  messages: readonly TMessage[] | TMessage[],
  options: AutoGenAdapterOptions<TMessage>
): Finding[] {
  const findings: Finding[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;

    const agentId = message.name || (message.role && message.role !== "user" && message.role !== "system" ? message.role : undefined);
    if (!agentId || agentId.trim().length === 0) continue;

    const score = options.scoreOf(message);
    const confidence = options.confidenceOf ? options.confidenceOf(message) : undefined;
    const tokens = options.tokensOf ? options.tokensOf(message) : undefined;
    const cost = options.costOf ? options.costOf(message) : undefined;

    let metadata: Record<string, unknown> = {};
    if (typeof message.content === "object" && message.content !== null && !Array.isArray(message.content)) {
      metadata = { ...(message.content as Record<string, unknown>) };
    } else if (message.content !== undefined) {
      metadata = { raw: message.content };
    }

    if (message.context) {
      metadata.context = message.context;
    }

    const finding: Finding = {
      agentId: agentId.trim(),
      score,
      metadata,
    };

    if (confidence !== undefined) finding.confidence = confidence;
    if (tokens !== undefined) finding.tokens = tokens;
    if (cost !== undefined) finding.cost = cost;

    findings.push(finding);
  }

  return findings;
}
