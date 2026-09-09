import { describe, expect, it } from "vitest";
import {
  runBackwardElimination,
  runPairwiseAblation,
  type Finding,
} from "../src/index.js";

describe("Backward Elimination & Combinatorial Ablation", () => {
  it("prunes redundant agents until minimal core panel is reached", () => {
    // Requires at least 2 positive signals (score >= 50) to approve
    const decide = (findings: Finding[]): "approved" | "rejected" => {
      const positiveCount = findings.filter((f) => f.score >= 50).length;
      return positiveCount >= 2 ? "approved" : "rejected";
    };

    const findings: Finding[] = [
      { agentId: "critic_1", score: 80 },
      { agentId: "critic_2", score: 80 },
      { agentId: "critic_3", score: 80 },
      { agentId: "scout_noisy", score: 10 },
      { agentId: "auditor_low", score: 15 },
    ];

    const result = runBackwardElimination(findings, decide);

    expect(result.baseline).toBe("approved");
    // Minimal set needs exactly 2 positive agents
    expect(result.minimalFindings).toHaveLength(2);
    expect(result.eliminatedAgentIds).toHaveLength(3);
    expect(result.stoppedDueToVerdictFlip).toBe(true);

    // Verify all remaining agents have score >= 50
    expect(result.minimalFindings.every((f) => f.score >= 50)).toBe(true);
  });

  it("detects pairwise interaction effects when LOO misses correlated agents", () => {
    // Quorum: Needs at least 2 agents scoring >= 50
    // If you have exactly 2 high scoring agents (A and B):
    // Removing A alone -> only 1 left -> flips to reject
    // But if you have 3 agents (A, B, C) where having at least 2 is required:
    // Removing A leaves B and C (no flip).
    // Removing B leaves A and C (no flip).
    // Removing C leaves A and B (no flip).
    // LOO reports 0 load-bearing agents!
    // But pairwise ablation reveals that removing (A, B) flips the verdict!

    const decide = (findings: Finding[]): "pass" | "fail" => {
      const active = findings.filter((f) => f.score >= 50).length;
      return active >= 2 ? "pass" : "fail";
    };

    const findings: Finding[] = [
      { agentId: "agent_a", score: 90 },
      { agentId: "agent_b", score: 90 },
      { agentId: "agent_c", score: 90 },
    ];

    const pairwiseResult = runPairwiseAblation(findings, decide);

    expect(pairwiseResult.baseline).toBe("pass");
    expect(pairwiseResult.pairs).toHaveLength(3);
    // Every pair removal drops active from 3 to 1, flipping verdict to 'fail'
    expect(pairwiseResult.interactionCount).toBe(3);
    expect(pairwiseResult.pairs.every((p) => p.isInteraction === true)).toBe(true);
  });
});
