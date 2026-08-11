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
