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
  /** Optional financial cost (in USD or custom currency unit) consumed to produce this finding. */
  cost?: number;
  /** Optional token count (prompt + completion) consumed to produce this finding. */
  tokens?: number;
  /** Optional execution time / latency in milliseconds. */
  latencyMs?: number;
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
 * Async function that aggregates a list of agent findings into a verdict.
 *
 * @typeParam TVerdict Type of the verdict produced by the decision function.
 */
export type AsyncDecisionFn<TVerdict> = (findings: Finding[]) => Promise<TVerdict> | TVerdict;

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
 * Detailed telemetry & ROI metrics for a single agent.
 */
export interface AgentRoiMetrics {
  /** Total dollar cost consumed across all appearances. */
  totalCost?: number;
  /** Total tokens consumed across all appearances. */
  totalTokens?: number;
  /** Mean latency in milliseconds. */
  averageLatencyMs?: number;
  /** Dollar cost per verdict flip (totalCost / verdictFlips). */
  costPerVerdictFlip?: number;
  /** Tokens per verdict flip (totalTokens / verdictFlips). */
  tokensPerVerdictFlip?: number;
  /** Percentage of overall multi-agent pipeline cost consumed by this agent. */
  costShare?: number;
  /** Ratio of influence share to cost share (>1 means high efficiency, <1 means expensive relative to impact). */
  efficiencyRatio?: number;
}

/**
 * Pruning or optimization recommendation for an agent.
 */
export interface PruningRecommendation {
  agentId: string;
  recommendation: "prune" | "downgrade_model" | "keep";
  reason: string;
}

/**
 * Aggregated ROI metrics across all agents.
 */
export interface RoiSummary {
  totalCost: number;
  totalTokens: number;
  agents: Record<string, AgentRoiMetrics>;
  recommendations: PruningRecommendation[];
}

/**
 * Accuracy and ground-truth metrics.
 */
export interface GroundTruthSummary {
  baselineAccuracy: number;
  correctBaselineCount: number;
  totalEvaluated: number;
}

/**
 * Statistics per agent including appearances, flips, and net accuracy impact.
 */
export interface PerAgentStats {
  appearances: number;
  flips: number;
  protectiveFlips?: number;
  correctiveFlips?: number;
  netAccuracyImpact?: number;
  role?: "Protective" | "Harmful" | "Neutral";
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
  /** Detailed statistics per agent. */
  perAgentStats?: Record<string, PerAgentStats>;
  /** Optional ROI breakdown (if cost/token telemetry was provided in findings). */
  roi?: RoiSummary;
  /** Optional ground-truth accuracy metrics (if groundTruth was supplied). */
  accuracy?: GroundTruthSummary;
}

/**
 * Options for batch ablation runs.
 */
export interface BatchAblationOptions<TVerdict> {
  /** Custom comparator for verdicts (defaults to ===). */
  equals?: (a: TVerdict, b: TVerdict) => boolean;
  /** Array of ground truth verdicts corresponding 1:1 with cases. */
  groundTruth?: TVerdict[];
}

/**
 * Options for async and stochastic ablation runs.
 */
export interface AsyncAblationOptions<TVerdict> {
  /** Custom comparator for verdicts (defaults to ===). */
  equals?: (a: TVerdict, b: TVerdict) => boolean;
  /** Number of stochastic samples to draw per decision (for non-deterministic LLM decide functions). Default: 1 */
  samples?: number;
  /** Custom aggregator for sample runs (defaults to majority voting). */
  aggregateSamples?: (samples: TVerdict[]) => TVerdict;
  /** Array of ground truth verdicts (for batch runs). */
  groundTruth?: TVerdict[];
}

function defaultEquals<TVerdict>(a: TVerdict, b: TVerdict): boolean {
  return a === b;
}

/**
 * Resolves majority vote across multiple stochastic sample evaluations.
 */
export function majorityVote<TVerdict>(
  samples: TVerdict[],
  equals: (a: TVerdict, b: TVerdict) => boolean = defaultEquals
): TVerdict {
  if (samples.length === 0) {
    throw new Error("Cannot compute majority vote of empty sample array");
  }
  if (samples.length === 1) {
    return samples[0] as TVerdict;
  }

  const clusters: { value: TVerdict; count: number }[] = [];
  for (const sample of samples) {
    const existing = clusters.find((c) => equals(c.value, sample));
    if (existing) {
      existing.count += 1;
    } else {
      clusters.push({ value: sample, count: 1 });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters[0]!.value;
}

/**
 * Runs a leave-one-out ablation over `findings`: computes the baseline verdict,
 * then re-runs `decide` once per finding with that finding removed, comparing each
 * result back to the baseline via `equals`.
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
 * Runs an asynchronous leave-one-out ablation over `findings`.
 * Supports stochastic decision functions with repeated K-sampling and majority voting.
 *
 * @param findings Array of agent findings to ablate.
 * @param decide Async decision function mapping findings to a verdict.
 * @param options Configuration for equals comparison, samples, and sampling aggregation.
 */
export async function runAblationAsync<TVerdict>(
  findings: Finding[],
  decide: AsyncDecisionFn<TVerdict>,
  options: AsyncAblationOptions<TVerdict> = {}
): Promise<AblationResult<TVerdict>> {
  const equals = options.equals || defaultEquals;
  const samples = options.samples ?? 1;

  async function evaluate(fs: Finding[]): Promise<TVerdict> {
    if (samples <= 1) {
      return await decide(fs.slice());
    }
    const sampleResults: TVerdict[] = [];
    for (let i = 0; i < samples; i++) {
      sampleResults.push(await decide(fs.slice()));
    }
    return options.aggregateSamples ? options.aggregateSamples(sampleResults) : majorityVote(sampleResults, equals);
  }

  const baseline = await evaluate(findings);

  const perAgent: PerAgentAblation<TVerdict>[] = [];
  for (let index = 0; index < findings.length; index++) {
    const finding = findings[index]!;
    const without = findings.slice(0, index).concat(findings.slice(index + 1));
    const verdictWithout = await evaluate(without);
    perAgent.push({
      removedAgentId: finding.agentId,
      verdictWithout,
      changed: !equals(baseline, verdictWithout),
    });
  }

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
 * Aggregates batch ablation results into summary metrics, ROI breakdown, and ground-truth accuracy impact.
 */
export function aggregateBatchResults<TVerdict>(
  cases: Finding[][],
  results: AblationResult<TVerdict>[],
  options: BatchAblationOptions<TVerdict> = {}
): BatchAblationSummary {
  const equals = options.equals || defaultEquals;
  const appearances = new Map<string, number>();
  const changedCounts = new Map<string, number>();
  const protectiveCounts = new Map<string, number>();
  const correctiveCounts = new Map<string, number>();

  const totalCostByAgent = new Map<string, number>();
  const totalTokensByAgent = new Map<string, number>();
  const totalLatencyByAgent = new Map<string, number>();
  let hasTelemetry = false;

  for (let caseIdx = 0; caseIdx < cases.length; caseIdx++) {
    const caseFindings = cases[caseIdx]!;
    const result = results[caseIdx]!;
    const gt = options.groundTruth ? options.groundTruth[caseIdx] : undefined;
    const baselineCorrect = gt !== undefined ? equals(result.baseline, gt) : undefined;

    for (const f of caseFindings) {
      if (f.cost !== undefined) {
        totalCostByAgent.set(f.agentId, (totalCostByAgent.get(f.agentId) ?? 0) + f.cost);
        hasTelemetry = true;
      }
      if (f.tokens !== undefined) {
        totalTokensByAgent.set(f.agentId, (totalTokensByAgent.get(f.agentId) ?? 0) + f.tokens);
        hasTelemetry = true;
      }
      if (f.latencyMs !== undefined) {
        totalLatencyByAgent.set(f.agentId, (totalLatencyByAgent.get(f.agentId) ?? 0) + f.latencyMs);
        hasTelemetry = true;
      }
    }

    for (const perAgent of result.perAgent) {
      const id = perAgent.removedAgentId;
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
      if (perAgent.changed) {
        changedCounts.set(id, (changedCounts.get(id) ?? 0) + 1);
      }

      if (gt !== undefined && baselineCorrect !== undefined) {
        const withoutCorrect = equals(perAgent.verdictWithout, gt);
        if (baselineCorrect && !withoutCorrect) {
          // Removing agent broke a correct decision (agent was protective)
          protectiveCounts.set(id, (protectiveCounts.get(id) ?? 0) + 1);
        } else if (!baselineCorrect && withoutCorrect) {
          // Removing agent fixed an incorrect decision (agent was harmful)
          correctiveCounts.set(id, (correctiveCounts.get(id) ?? 0) + 1);
        }
      }
    }
  }

  const perAgentInfluence: Record<string, number> = {};
  const perAgentStats: Record<string, PerAgentStats> = {};

  for (const [id, count] of appearances) {
    const flips = changedCounts.get(id) ?? 0;
    const influence = flips / count;
    perAgentInfluence[id] = influence;

    const stats: PerAgentStats = {
      appearances: count,
      flips,
    };

    if (options.groundTruth) {
      const protective = protectiveCounts.get(id) ?? 0;
      const corrective = correctiveCounts.get(id) ?? 0;
      const net = (protective - corrective) / count;
      stats.protectiveFlips = protective;
      stats.correctiveFlips = corrective;
      stats.netAccuracyImpact = net;
      stats.role = net > 0.01 ? "Protective" : net < -0.01 ? "Harmful" : "Neutral";
    }

    perAgentStats[id] = stats;
  }

  const averageLoadBearingRatio =
    results.length === 0
      ? 0
      : results.reduce((sum, r) => sum + r.loadBearingRatio, 0) / results.length;

  const summary: BatchAblationSummary = {
    cases: cases.length,
    averageLoadBearingRatio,
    perAgentInfluence,
    perAgentStats,
  };

  if (options.groundTruth && options.groundTruth.length === results.length) {
    const correctCount = results.filter((r, idx) => equals(r.baseline, options.groundTruth![idx]!)).length;
    summary.accuracy = {
      baselineAccuracy: results.length === 0 ? 0 : correctCount / results.length,
      correctBaselineCount: correctCount,
      totalEvaluated: results.length,
    };
  }

  if (hasTelemetry) {
    let pipelineTotalCost = 0;
    let pipelineTotalTokens = 0;

    for (const c of totalCostByAgent.values()) pipelineTotalCost += c;
    for (const t of totalTokensByAgent.values()) pipelineTotalTokens += t;

    const agentsRoi: Record<string, AgentRoiMetrics> = {};
    const recommendations: PruningRecommendation[] = [];

    for (const [id, count] of appearances) {
      const agentCost = totalCostByAgent.get(id);
      const agentTokens = totalTokensByAgent.get(id);
      const agentLatency = totalLatencyByAgent.get(id);
      const flips = changedCounts.get(id) ?? 0;
      const influence = perAgentInfluence[id] ?? 0;

      const roi: AgentRoiMetrics = {};
      if (agentCost !== undefined) {
        roi.totalCost = agentCost;
        if (flips > 0) roi.costPerVerdictFlip = agentCost / flips;
        if (pipelineTotalCost > 0) roi.costShare = agentCost / pipelineTotalCost;
      }
      if (agentTokens !== undefined) {
        roi.totalTokens = agentTokens;
        if (flips > 0) roi.tokensPerVerdictFlip = agentTokens / flips;
      }
      if (agentLatency !== undefined) {
        roi.averageLatencyMs = agentLatency / count;
      }

      if (roi.costShare !== undefined && roi.costShare > 0) {
        roi.efficiencyRatio = influence / roi.costShare;
      }

      agentsRoi[id] = roi;

      // Automated recommendation checks
      if (roi.costShare !== undefined && roi.costShare >= 0.2 && influence <= 0.05) {
        recommendations.push({
          agentId: id,
          recommendation: "prune",
          reason: `High compute cost (${(roi.costShare * 100).toFixed(1)}% of total cost) with negligible verdict impact (${(influence * 100).toFixed(1)}% influence).`,
        });
      } else if (roi.efficiencyRatio !== undefined && roi.efficiencyRatio < 0.25 && (roi.totalCost ?? 0) > 0.1) {
        recommendations.push({
          agentId: id,
          recommendation: "downgrade_model",
          reason: `Low efficiency ratio (${roi.efficiencyRatio.toFixed(2)}x). Consider replacing with a smaller/cheaper model.`,
        });
      }
    }

    summary.roi = {
      totalCost: pipelineTotalCost,
      totalTokens: pipelineTotalTokens,
      agents: agentsRoi,
      recommendations,
    };
  }

  return summary;
}

/**
 * Runs `runAblation` over a batch of independent cases and aggregates the results:
 * the mean load-bearing ratio across cases, per-agent influence, telemetry ROI, and ground-truth accuracy impact.
 *
 * @param cases Array of cases, where each case is an array of findings.
 * @param decide Pure decision function mapping findings to a verdict.
 * @param options Optional configuration object or comparator function.
 * @returns Individual case results and aggregated batch summary.
 */
export function batchAblation<TVerdict>(
  cases: Finding[][],
  decide: DecisionFn<TVerdict>,
  options: ((a: TVerdict, b: TVerdict) => boolean) | BatchAblationOptions<TVerdict> = defaultEquals
): { results: AblationResult<TVerdict>[]; summary: BatchAblationSummary } {
  const opts: BatchAblationOptions<TVerdict> =
    typeof options === "function" ? { equals: options } : options;
  const equals = opts.equals || defaultEquals;

  const results = cases.map((findings) => runAblation(findings, decide, equals));
  const summary = aggregateBatchResults(cases, results, opts);

  return { results, summary };
}

/**
 * Runs `runAblationAsync` over a batch of cases with async/stochastic decision functions.
 */
export async function batchAblationAsync<TVerdict>(
  cases: Finding[][],
  decide: AsyncDecisionFn<TVerdict>,
  options: AsyncAblationOptions<TVerdict> = {}
): Promise<{ results: AblationResult<TVerdict>[]; summary: BatchAblationSummary }> {
  const results: AblationResult<TVerdict>[] = [];
  for (const c of cases) {
    results.push(await runAblationAsync(c, decide, options));
  }
  const summary = aggregateBatchResults(cases, results, options);
  return { results, summary };
}

/**
 * Result of a greedy backward elimination pass to find the minimal agent panel.
 */
export interface BackwardEliminationResult<TVerdict> {
  /** Baseline verdict with all findings present. */
  baseline: TVerdict;
  /** Minimal subset of findings required to sustain the baseline verdict. */
  minimalFindings: Finding[];
  /** Agent IDs in the minimal subset. */
  minimalAgentIds: string[];
  /** Agents pruned during elimination in order of pruning. */
  eliminatedAgentIds: string[];
  /** Step-by-step trace of elimination rounds. */
  steps: {
    step: number;
    eliminatedAgentId: string;
    remainingAgentIds: string[];
    verdict: TVerdict;
  }[];
  /** Whether elimination stopped because removing any further agent flips the verdict. */
  stoppedDueToVerdictFlip: boolean;
}

/**
 * Performs greedy backward elimination over an agent panel.
 * Iteratively removes the least impactful agent while verifying that the verdict remains identical to the baseline.
 * Stops when removing any remaining agent flips the verdict, revealing the minimal viable agent panel.
 *
 * @param findings Array of agent findings.
 * @param decide Decision function.
 * @param equals Optional verdict comparator.
 */
export function runBackwardElimination<TVerdict>(
  findings: Finding[],
  decide: DecisionFn<TVerdict>,
  equals: (a: TVerdict, b: TVerdict) => boolean = defaultEquals
): BackwardEliminationResult<TVerdict> {
  const baseline = decide(findings.slice());
  let currentFindings = findings.slice();
  const eliminatedAgentIds: string[] = [];
  const steps: BackwardEliminationResult<TVerdict>["steps"] = [];

  while (currentFindings.length > 1) {
    let candidateIndexToRemove = -1;
    let candidateVerdict: TVerdict | undefined;

    // Check every remaining agent to find one whose removal preserves the baseline verdict
    for (let i = 0; i < currentFindings.length; i++) {
      const withoutCandidate = currentFindings.slice(0, i).concat(currentFindings.slice(i + 1));
      const v = decide(withoutCandidate);
      if (equals(baseline, v)) {
        // Can be safely eliminated
        candidateIndexToRemove = i;
        candidateVerdict = v;
        break;
      }
    }

    if (candidateIndexToRemove === -1) {
      // No more agents can be removed without flipping the verdict
      return {
        baseline,
        minimalFindings: currentFindings,
        minimalAgentIds: currentFindings.map((f) => f.agentId),
        eliminatedAgentIds,
        steps,
        stoppedDueToVerdictFlip: true,
      };
    }

    const removed = currentFindings[candidateIndexToRemove]!;
    currentFindings = currentFindings.slice(0, candidateIndexToRemove).concat(currentFindings.slice(candidateIndexToRemove + 1));
    eliminatedAgentIds.push(removed.agentId);

    steps.push({
      step: steps.length + 1,
      eliminatedAgentId: removed.agentId,
      remainingAgentIds: currentFindings.map((f) => f.agentId),
      verdict: candidateVerdict!,
    });
  }

  return {
    baseline,
    minimalFindings: currentFindings,
    minimalAgentIds: currentFindings.map((f) => f.agentId),
    eliminatedAgentIds,
    steps,
    stoppedDueToVerdictFlip: false,
  };
}

/**
 * Async version of greedy backward elimination.
 */
export async function runBackwardEliminationAsync<TVerdict>(
  findings: Finding[],
  decide: AsyncDecisionFn<TVerdict>,
  options: AsyncAblationOptions<TVerdict> = {}
): Promise<BackwardEliminationResult<TVerdict>> {
  const equals = options.equals || defaultEquals;
  const samples = options.samples ?? 1;

  async function evaluate(fs: Finding[]): Promise<TVerdict> {
    if (samples <= 1) return await decide(fs.slice());
    const sampleResults: TVerdict[] = [];
    for (let i = 0; i < samples; i++) sampleResults.push(await decide(fs.slice()));
    return options.aggregateSamples ? options.aggregateSamples(sampleResults) : majorityVote(sampleResults, equals);
  }

  const baseline = await evaluate(findings);
  let currentFindings = findings.slice();
  const eliminatedAgentIds: string[] = [];
  const steps: BackwardEliminationResult<TVerdict>["steps"] = [];

  while (currentFindings.length > 1) {
    let candidateIndexToRemove = -1;
    let candidateVerdict: TVerdict | undefined;

    for (let i = 0; i < currentFindings.length; i++) {
      const withoutCandidate = currentFindings.slice(0, i).concat(currentFindings.slice(i + 1));
      const v = await evaluate(withoutCandidate);
      if (equals(baseline, v)) {
        candidateIndexToRemove = i;
        candidateVerdict = v;
        break;
      }
    }

    if (candidateIndexToRemove === -1) {
      return {
        baseline,
        minimalFindings: currentFindings,
        minimalAgentIds: currentFindings.map((f) => f.agentId),
        eliminatedAgentIds,
        steps,
        stoppedDueToVerdictFlip: true,
      };
    }

    const removed = currentFindings[candidateIndexToRemove]!;
    currentFindings = currentFindings.slice(0, candidateIndexToRemove).concat(currentFindings.slice(candidateIndexToRemove + 1));
    eliminatedAgentIds.push(removed.agentId);

    steps.push({
      step: steps.length + 1,
      eliminatedAgentId: removed.agentId,
      remainingAgentIds: currentFindings.map((f) => f.agentId),
      verdict: candidateVerdict!,
    });
  }

  return {
    baseline,
    minimalFindings: currentFindings,
    minimalAgentIds: currentFindings.map((f) => f.agentId),
    eliminatedAgentIds,
    steps,
    stoppedDueToVerdictFlip: false,
  };
}

/**
 * Pairwise interaction ablation result.
 */
export interface PairwiseAblationItem<TVerdict> {
  pair: [string, string];
  verdictWithout: TVerdict;
  changed: boolean;
  /** True if removing neither agent alone changed the outcome, but removing both together did! */
  isInteraction: boolean;
}

export interface PairwiseAblationResult<TVerdict> {
  baseline: TVerdict;
  pairs: PairwiseAblationItem<TVerdict>[];
  interactionCount: number;
}

/**
 * Evaluates pairwise combinations (pairs of agents) to detect joint dependencies where neither agent alone is load-bearing,
 * but removing both together flips the outcome.
 */
export function runPairwiseAblation<TVerdict>(
  findings: Finding[],
  decide: DecisionFn<TVerdict>,
  equals: (a: TVerdict, b: TVerdict) => boolean = defaultEquals
): PairwiseAblationResult<TVerdict> {
  const singleResult = runAblation(findings, decide, equals);
  const baseline = singleResult.baseline;
  const singleChangedMap = new Map<string, boolean>();
  for (const p of singleResult.perAgent) {
    singleChangedMap.set(p.removedAgentId, p.changed);
  }

  const pairs: PairwiseAblationItem<TVerdict>[] = [];

  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      const agentI = findings[i]!;
      const agentJ = findings[j]!;

      const withoutPair = findings.filter((_, idx) => idx !== i && idx !== j);
      const verdictWithout = decide(withoutPair);
      const changed = !equals(baseline, verdictWithout);

      const singleIChanged = singleChangedMap.get(agentI.agentId) ?? false;
      const singleJChanged = singleChangedMap.get(agentJ.agentId) ?? false;
      const isInteraction = changed && !singleIChanged && !singleJChanged;

      pairs.push({
        pair: [agentI.agentId, agentJ.agentId],
        verdictWithout,
        changed,
        isInteraction,
      });
    }
  }

  const interactionCount = pairs.filter((p) => p.isInteraction).length;

  return {
    baseline,
    pairs,
    interactionCount,
  };
}

export {
  fromLangGraphMessages,
  fromRecords,
  type LangGraphAgentMessage,
  type LangGraphAdapterOptions,
} from "./adapters/langgraph.js";

export {
  fromCrewAITasks,
  type CrewAITaskOutput,
  type CrewAIAdapterOptions,
} from "./adapters/crewai.js";

export {
  fromAutoGenMessages,
  type AutoGenMessage,
  type AutoGenAdapterOptions,
} from "./adapters/autogen.js";

export {
  fromAISDKSteps,
  type AISDKStepResult,
  type AISDKAdapterOptions,
} from "./adapters/vercel.js";

export {
  formatMarkdownReport,
  formatAsciiTable,
  type ReportOptions,
} from "./reporters/index.js";
