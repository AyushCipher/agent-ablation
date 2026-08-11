import { describe, expect, it } from "vitest";
import { batchAblation, runAblation, type Finding } from "../src/index.js";

type SimpleVerdict = "auto_decline" | "auto_approve" | "escalate";

/**
 * A simplified stand-in for SentryMesh's real supervisor decision logic: findings
 * combine via noisy-OR (`1 - Π(1 - score/100)`, per SentryMesh's own README), and a
 * verdict is only trusted when panel confidence clears a gate — otherwise the case
 * escalates regardless of how high or low the raw risk number is.
 */
function sentryMeshStyleDecide(findings: Finding[]): SimpleVerdict {
  const DECLINE_THRESHOLD = 70;
  const APPROVE_THRESHOLD = 30;
  const CONFIDENCE_GATE = 0.6;

  if (findings.length === 0) return "escalate";

  const survivalProduct = findings.reduce((product, f) => product * (1 - f.score / 100), 1);
  const risk = (1 - survivalProduct) * 100;
  const avgConfidence =
    findings.reduce((sum, f) => sum + (f.confidence ?? 1), 0) / findings.length;

  if (avgConfidence >= CONFIDENCE_GATE) {
    if (risk >= DECLINE_THRESHOLD) return "auto_decline";
    if (risk <= APPROVE_THRESHOLD) return "auto_approve";
  }
  return "escalate";
}

describe("runAblation", () => {
  it("reports loadBearingRatio 0 when no agent is load-bearing", () => {
    const decide = (findings: Finding[]): SimpleVerdict =>
      findings.reduce((sum, f) => sum + f.score, 0) / findings.length >= 50
        ? "auto_decline"
        : "auto_approve";

    const findings: Finding[] = [
      { agentId: "a", score: 5 },
      { agentId: "b", score: 8 },
      { agentId: "c", score: 6 },
      { agentId: "d", score: 7 },
      { agentId: "e", score: 9 },
    ];

    const result = runAblation(findings, decide);

    expect(result.baseline).toBe("auto_approve");
    expect(result.perAgent.every((p) => p.changed === false)).toBe(true);
    expect(result.loadBearingCount).toBe(0);
    expect(result.loadBearingRatio).toBe(0);
    expect(result.totalAgents).toBe(5);
  });

  it("reports loadBearingRatio 1 when every agent is load-bearing", () => {
    const QUORUM = 5;
    const decide = (findings: Finding[]): SimpleVerdict =>
      findings.length >= QUORUM ? "auto_decline" : "escalate";

    const findings: Finding[] = [
      { agentId: "a", score: 60 },
      { agentId: "b", score: 60 },
      { agentId: "c", score: 60 },
      { agentId: "d", score: 60 },
      { agentId: "e", score: 60 },
    ];

    const result = runAblation(findings, decide);

    expect(result.baseline).toBe("auto_decline");
    expect(result.perAgent.every((p) => p.changed === true)).toBe(true);
    expect(result.loadBearingCount).toBe(5);
    expect(result.loadBearingRatio).toBe(1);
  });

  it("uses a supplied equals function instead of reference equality", () => {
    // decide() returns a fresh object every call, so under default `===` every
    // ablation spuriously reads as "changed" even when the meaningful content
    // (the label) is identical.
    const decide = (findings: Finding[]): { label: SimpleVerdict } => ({
      label:
        findings.reduce((sum, f) => sum + f.score, 0) / findings.length >= 50
          ? "auto_decline"
          : "auto_approve",
    });

    const findings: Finding[] = [
      { agentId: "a", score: 5 },
      { agentId: "b", score: 8 },
      { agentId: "c", score: 6 },
    ];

    const withDefaultEquals = runAblation(findings, decide);
    expect(withDefaultEquals.perAgent.every((p) => p.changed === true)).toBe(true);
    expect(withDefaultEquals.loadBearingRatio).toBe(1);

    const withCustomEquals = runAblation(findings, decide, (a, b) => a.label === b.label);
    expect(withCustomEquals.perAgent.every((p) => p.changed === false)).toBe(true);
    expect(withCustomEquals.loadBearingRatio).toBe(0);
  });
});

describe("batchAblation", () => {
  it("computes averageLoadBearingRatio and perAgentInfluence correctly", () => {
    // Simple OR-style decide: 'flag' if any finding scores >= 50, else 'clear'.
    const decide = (findings: Finding[]): "flag" | "clear" =>
      findings.some((f) => f.score >= 50) ? "flag" : "clear";

    const cases: Finding[][] = [
      // Case 1: only A is >=50. Removing A flips 'flag'->'clear' (A load-bearing).
      // Removing B leaves A, still 'flag' (B not load-bearing). Ratio 1/2.
      [
        { agentId: "A", score: 80 },
        { agentId: "B", score: 10 },
      ],
      // Case 2: both low, baseline 'clear'. Removing either leaves the other
      // still low, so 'clear' either way. Ratio 0/2.
      [
        { agentId: "A", score: 5 },
        { agentId: "B", score: 5 },
      ],
      // Case 3: both high, baseline 'flag'. Removing either leaves the other
      // still >=50, so 'flag' either way. Ratio 0/2.
      [
        { agentId: "A", score: 60 },
        { agentId: "B", score: 70 },
      ],
    ];

    const { results, summary } = batchAblation(cases, decide);

    expect(results).toHaveLength(3);
    expect(summary.cases).toBe(3);
    // (0.5 + 0 + 0) / 3
    expect(summary.averageLoadBearingRatio).toBeCloseTo(1 / 6, 10);
    // A: load-bearing in 1 of 3 cases; B: load-bearing in 0 of 3 cases.
    expect(summary.perAgentInfluence.A).toBeCloseTo(1 / 3, 10);
    expect(summary.perAgentInfluence.B).toBe(0);
  });
});

describe("SentryMesh worked example (real six-case ablation from the SentryMesh README)", () => {
  // Per-case findings are constructed so that the named "loudest" specialist's
  // score matches SentryMesh's own ablation table exactly (identity_signal 100 /
  // 75 / 80 / 70, network_analysis 90, transaction_pattern 26); the other three
  // specialists' scores are filled in to be consistent with SentryMesh's own
  // description of these cases ("one signal drives the decision, the rest add
  // little or nothing").
  const cases: Record<string, { findings: Finding[]; baseline: SimpleVerdict; loudAgent: string }> = {
    "SM-001": {
      baseline: "auto_decline",
      loudAgent: "identity_signal",
      findings: [
        { agentId: "transaction_pattern", score: 25, confidence: 0.8 },
        { agentId: "identity_signal", score: 100, confidence: 0.8 },
        { agentId: "network_analysis", score: 20, confidence: 0.8 },
        { agentId: "historical_case", score: 15, confidence: 0.8 },
      ],
    },
    "SM-002": {
      baseline: "auto_decline",
      loudAgent: "identity_signal",
      findings: [
        { agentId: "transaction_pattern", score: 20, confidence: 0.8 },
        { agentId: "identity_signal", score: 75, confidence: 0.8 },
        { agentId: "network_analysis", score: 15, confidence: 0.8 },
        { agentId: "historical_case", score: 10, confidence: 0.8 },
      ],
    },
    "SM-005": {
      baseline: "auto_decline",
      loudAgent: "identity_signal",
      findings: [
        { agentId: "transaction_pattern", score: 20, confidence: 0.8 },
        { agentId: "identity_signal", score: 80, confidence: 0.8 },
        { agentId: "network_analysis", score: 18, confidence: 0.8 },
        { agentId: "historical_case", score: 12, confidence: 0.8 },
      ],
    },
    "SM-006": {
      baseline: "auto_decline",
      loudAgent: "identity_signal",
      findings: [
        { agentId: "transaction_pattern", score: 15, confidence: 0.8 },
        { agentId: "identity_signal", score: 70, confidence: 0.8 },
        { agentId: "network_analysis", score: 20, confidence: 0.8 },
        { agentId: "historical_case", score: 12, confidence: 0.8 },
      ],
    },
    "SM-012": {
      baseline: "auto_decline",
      loudAgent: "network_analysis",
      findings: [
        { agentId: "transaction_pattern", score: 20, confidence: 0.8 },
        { agentId: "identity_signal", score: 25, confidence: 0.8 },
        { agentId: "network_analysis", score: 90, confidence: 0.8 },
        { agentId: "historical_case", score: 15, confidence: 0.8 },
      ],
    },
    "SM-016": {
      baseline: "auto_approve",
      loudAgent: "transaction_pattern",
      findings: [
        { agentId: "transaction_pattern", score: 26, confidence: 0.9 },
        { agentId: "identity_signal", score: 2, confidence: 0.55 },
        { agentId: "network_analysis", score: 1, confidence: 0.55 },
        { agentId: "historical_case", score: 1, confidence: 0.55 },
      ],
    },
  };

  for (const [caseId, { findings, baseline, loudAgent }] of Object.entries(cases)) {
    it(`${caseId}: collapses to escalate when ${loudAgent} is removed`, () => {
      const result = runAblation(findings, sentryMeshStyleDecide);

      expect(result.baseline).toBe(baseline);

      const loudRemoval = result.perAgent.find((p) => p.removedAgentId === loudAgent);
      expect(loudRemoval).toBeDefined();
      expect(loudRemoval?.verdictWithout).toBe("escalate");
      expect(loudRemoval?.changed).toBe(true);
    });
  }

  it("reproduces the 33% multi-signal share via batchAblation", () => {
    const allFindings = Object.values(cases).map((c) => c.findings);
    const { results } = batchAblation(allFindings, sentryMeshStyleDecide);

    // Of the 6 auto-decisions, only the removal of the named loud specialist
    // flips each one to escalate — matching SentryMesh's own reported "6 of 9
    // auto-decisions collapse under ablation of their single loudest specialist".
    const collapsedCount = results.filter((r) => r.loadBearingCount >= 1).length;
    expect(collapsedCount).toBe(6);
  });
});
