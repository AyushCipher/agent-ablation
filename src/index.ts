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
