export interface Finding {
  agentId: string;
  score: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export type DecisionFn<TVerdict> = (findings: Finding[]) => TVerdict;

export interface PerAgentAblation<TVerdict> {
  removedAgentId: string;
  verdictWithout: TVerdict;
  changed: boolean;
}

export interface AblationResult<TVerdict> {
  baseline: TVerdict;
  perAgent: PerAgentAblation<TVerdict>[];
  loadBearingCount: number;
  totalAgents: number;
  loadBearingRatio: number;
}

export interface BatchAblationSummary {
  cases: number;
  averageLoadBearingRatio: number;
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
