import type { Finding } from "../index.js";

/**
 * Structural representation of a message produced by a LangGraph / LangChain agent.
 *
 * Convenience mapper type designed without importing any LangChain / LangGraph packages.
 */
export interface LangGraphAgentMessage {
  /**
   * The name of the agent or node that produced the message.
   * Messages without a valid name are skipped during conversion.
   */
  name?: string | null;

  /**
   * The message content. Can be a string, a structured object (e.g. parsed JSON),
   * or any arbitrary payload.
   */
  content?: unknown;

  /**
   * Arbitrary additional properties from the message structure.
   */
  [key: string]: unknown;
}

/**
 * Options for mapping LangGraph messages into findings.
 */
export interface LangGraphAdapterOptions<TMessage extends LangGraphAgentMessage = LangGraphAgentMessage> {
  /**
   * Required mapping function to extract the numerical score from each message.
   */
  scoreOf: (message: TMessage) => number;

  /**
   * Optional mapping function to extract a numerical confidence from each message.
   */
  confidenceOf?: (message: TMessage) => number | undefined;
}

/**
 * Converts an array of LangGraph-style agent messages into `Finding` objects for ablation.
 *
 * Rules:
 * - Entries without a valid string `name` are ignored.
 * - `scoreOf(message)` is invoked for each named message to extract its score.
 * - `confidenceOf(message)` is invoked if provided.
 * - Object `content` is stored directly as `metadata`.
 * - String `content` is wrapped inside `{ raw: content }` as `metadata`.
 *
 * @param messages Array of message-like objects (e.g. `state.messages`).
 * @param options Mapping options requiring `scoreOf` and optional `confidenceOf`.
 * @returns Array of `Finding` objects ready for `runAblation`.
 */
export function fromLangGraphMessages<TMessage extends LangGraphAgentMessage = LangGraphAgentMessage>(
  messages: readonly TMessage[] | TMessage[],
  options: LangGraphAdapterOptions<TMessage>
): Finding[] {
  const findings: Finding[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    if (typeof message.name !== "string" || message.name.trim().length === 0) {
      continue;
    }

    const agentId = message.name;
    const score = options.scoreOf(message);
    const confidence = options.confidenceOf ? options.confidenceOf(message) : undefined;

    let metadata: Record<string, unknown> | undefined;
    if (typeof message.content === "string") {
      metadata = { raw: message.content };
    } else if (
      typeof message.content === "object" &&
      message.content !== null &&
      !Array.isArray(message.content)
    ) {
      metadata = { ...(message.content as Record<string, unknown>) };
    } else if (message.content !== undefined && message.content !== null) {
      metadata = { raw: message.content };
    }

    const finding: Finding = {
      agentId,
      score,
    };

    if (confidence !== undefined) {
      finding.confidence = confidence;
    }

    if (metadata !== undefined) {
      finding.metadata = metadata;
    }

    findings.push(finding);
  }

  return findings;
}

/**
 * Converts an arbitrary array of records into `Finding` objects using user-supplied mapping functions.
 * Preserves the original record in `metadata`.
 *
 * @param records Array of arbitrary records.
 * @param options Mapping configuration providing `agentId`, `scoreOf`, and optional `confidenceOf`.
 * @returns Array of `Finding` objects ready for `runAblation`.
 */
export function fromRecords<T>(
  records: readonly T[] | T[],
  options: {
    agentId: (record: T, index: number) => string;
    scoreOf: (record: T, index: number) => number;
    confidenceOf?: (record: T, index: number) => number | undefined;
  }
): Finding[] {
  return records.map((record, index) => {
    const agentId = options.agentId(record, index);
    const score = options.scoreOf(record, index);
    const confidence = options.confidenceOf ? options.confidenceOf(record, index) : undefined;

    const metadata: Record<string, unknown> =
      typeof record === "object" && record !== null && !Array.isArray(record)
        ? { ...(record as Record<string, unknown>) }
        : { raw: record };

    const finding: Finding = {
      agentId,
      score,
      metadata,
    };

    if (confidence !== undefined) {
      finding.confidence = confidence;
    }

    return finding;
  });
}
