/**
 * Represents a single finding or signal produced by an individual agent.
 */
export interface Finding {
  /** Unique identifier of the agent that produced this finding. */
  agentId: string;
  /** Numerical score or risk rating produced by the agent. */
  score: number;
  /** Optional confidence score (e.g. 0 to 1) associated with the finding. */
  confidence?: number;
  /** Arbitrary metadata associated with the finding (e.g. raw output or attributes). */
  metadata?: Record<string, unknown>;
}

/**
 * Pure function that aggregates a list of agent findings into a verdict.
 *
 * @typeParam TVerdict Type of the verdict produced by the decision function.
 */
export type DecisionFn<TVerdict> = (findings: Finding[]) => TVerdict;

/**
 * Outcome of ablating a single agent from the panel.
 *
 * @typeParam TVerdict Type of the decision verdict.
 */
export interface PerAgentAblation<TVerdict> {
  /** Identifier of the agent that was removed in this ablation run. */
  removedAgentId: string;
  /** Verdict produced by the decision function without this agent's finding. */
  verdictWithout: TVerdict;
  /** Whether the verdict changed compared to the baseline verdict. */
  changed: boolean;
}

/**
 * Result of a leave-one-out ablation across all agents for a single decision.
 *
 * @typeParam TVerdict Type of the decision verdict.
 */
export interface AblationResult<TVerdict> {
  /** Original decision verdict produced with all findings present. */
  baseline: TVerdict;
  /** Detailed per-agent ablation outcomes. */
  perAgent: PerAgentAblation<TVerdict>[];
  /** Count of agents whose removal flipped the decision outcome. */
  loadBearingCount: number;
  /** Total number of agents evaluated in this decision. */
  totalAgents: number;
  /** Fraction of agents that were load-bearing (`loadBearingCount / totalAgents`). */
  loadBearingRatio: number;
}

/**
 * Summary metrics aggregated across a batch of ablation cases.
 */
export interface BatchAblationSummary {
  /** Total number of cases evaluated in the batch. */
  cases: number;
  /** Mean load-bearing ratio across all evaluated cases. */
  averageLoadBearingRatio: number;
  /** Map of agent IDs to the fraction of cases where removing that agent changed the outcome. */
  perAgentInfluence: Record<string, number>;
}

function defaultEquals<TVerdict>(a: TVerdict, b: TVerdict): boolean {
  return a === b;
}

/**
 * Runs a leave-one-out ablation over `findings`: computes the baseline verdict,
 * then re-runs `decide` once per finding with that finding removed, comparing each
 * result back to the baseline via `equals`.
 *
 * `equals` defaults to `===`. If TVerdict is an object or otherwise compared by
 * reference (not a primitive like a string or number), you MUST supply your own
 * `equals` — otherwise every ablation will spuriously read as "changed" because two
 * structurally identical objects are never `===` to one another, even when nothing
 * about the decision actually differed.
 *
 * @param findings Array of agent findings to ablate.
 * @param decide Pure decision function mapping findings to a verdict.
 * @param equals Optional comparator for verdicts (defaults to `===`).
 * @returns Ablation results containing baseline verdict and per-agent outcomes.
 */
export function runAblation<TVerdict>(
  findings: Finding[],
  decide: DecisionFn<TVerdict>,
  equals: (a: TVerdict, b: TVerdict) => boolean = defaultEquals
): AblationResult<TVerdict> {
  const baseline = decide(findings.slice());

  const perAgent: PerAgentAblation<TVerdict>[] = findings.map((finding, index) => {
    const without = findings.slice(0, index).concat(findings.slice(index + 1));
    const verdictWithout = decide(without);
    return {
      removedAgentId: finding.agentId,
      verdictWithout,
      changed: !equals(baseline, verdictWithout),
    };
  });

  const totalAgents = findings.length;
  const loadBearingCount = perAgent.filter((p) => p.changed).length;
  const loadBearingRatio = totalAgents === 0 ? 0 : loadBearingCount / totalAgents;

  return {
    baseline,
    perAgent,
    loadBearingCount,
    totalAgents,
    loadBearingRatio,
  };
}

/**
 * Runs `runAblation` over a batch of independent cases and aggregates the results:
 * the mean load-bearing ratio across cases, and, per agent ID, the fraction of the
 * cases containing that agent in which removing it flipped the verdict.
 *
 * @param cases Array of cases, where each case is an array of findings.
 * @param decide Pure decision function mapping findings to a verdict.
 * @param equals Optional comparator for verdicts (defaults to `===`).
 * @returns Individual case results and aggregated batch summary.
 */
export function batchAblation<TVerdict>(
  cases: Finding[][],
  decide: DecisionFn<TVerdict>,
  equals: (a: TVerdict, b: TVerdict) => boolean = defaultEquals
): { results: AblationResult<TVerdict>[]; summary: BatchAblationSummary } {
  const results = cases.map((findings) => runAblation(findings, decide, equals));

  const appearances = new Map<string, number>();
  const changedCounts = new Map<string, number>();

  for (const result of results) {
    for (const perAgent of result.perAgent) {
      const id = perAgent.removedAgentId;
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
      if (perAgent.changed) {
        changedCounts.set(id, (changedCounts.get(id) ?? 0) + 1);
      }
    }
  }

  const perAgentInfluence: Record<string, number> = {};
  for (const [id, count] of appearances) {
    perAgentInfluence[id] = (changedCounts.get(id) ?? 0) / count;
  }

  const averageLoadBearingRatio =
    results.length === 0
      ? 0
      : results.reduce((sum, r) => sum + r.loadBearingRatio, 0) / results.length;

  const summary: BatchAblationSummary = {
    cases: cases.length,
    averageLoadBearingRatio,
    perAgentInfluence,
  };

  return { results, summary };
}

export {
  fromLangGraphMessages,
  fromRecords,
  type LangGraphAgentMessage,
  type LangGraphAdapterOptions,
} from "./adapters/langgraph.js";
