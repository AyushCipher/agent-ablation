import { describe, expect, it } from "vitest";
import {
  batchAblationAsync,
  majorityVote,
  runAblationAsync,
  type Finding,
} from "../src/index.js";

describe("Async & Stochastic Ablation", () => {
  it("runs async ablation with Promise-based decision functions", async () => {
    const asyncDecide = async (findings: Finding[]): Promise<"flag" | "clear"> => {
      // simulate async latency
      await new Promise((r) => setTimeout(r, 5));
      return findings.some((f) => f.score >= 50) ? "flag" : "clear";
    };

    const findings: Finding[] = [
      { agentId: "agent_a", score: 85 },
      { agentId: "agent_b", score: 10 },
    ];

    const result = await runAblationAsync(findings, asyncDecide);

    expect(result.baseline).toBe("flag");
    expect(result.loadBearingCount).toBe(1);
    expect(result.perAgent.find((p) => p.removedAgentId === "agent_a")?.changed).toBe(true);
    expect(result.perAgent.find((p) => p.removedAgentId === "agent_b")?.changed).toBe(false);
  });

  it("handles repeated sampling / majority voting for stochastic decide", async () => {
    let callCount = 0;
    // Simulates an LLM judge with random sampling noise (4 out of 5 return 'auto_decline', 1 returns 'escalate')
    const stochasticDecide = async (findings: Finding[]): Promise<"auto_decline" | "escalate"> => {
      callCount++;
      const hasLoudSignal = findings.some((f) => f.score >= 70);
      if (!hasLoudSignal) return "escalate";
      // 80% consensus for auto_decline
      return callCount % 5 === 0 ? "escalate" : "auto_decline";
    };

    const findings: Finding[] = [
      { agentId: "loud_specialist", score: 95 },
      { agentId: "quiet_specialist", score: 20 },
    ];

    const result = await runAblationAsync(findings, stochasticDecide, {
      samples: 5,
    });

    expect(result.baseline).toBe("auto_decline");
    const loud = result.perAgent.find((p) => p.removedAgentId === "loud_specialist");
    expect(loud?.changed).toBe(true);
    expect(loud?.verdictWithout).toBe("escalate");
  });

  it("majorityVote correctly selects highest frequency verdict", () => {
    expect(majorityVote(["approve", "decline", "approve"])).toBe("approve");
    expect(majorityVote(["decline", "decline", "approve"])).toBe("decline");
    expect(majorityVote(["escalate"])).toBe("escalate");
  });

  it("batchAblationAsync runs across multiple cases", async () => {
    const asyncDecide = async (findings: Finding[]) =>
      findings.some((f) => f.score >= 50) ? "pass" : "fail";

    const cases: Finding[][] = [
      [{ agentId: "a", score: 60 }, { agentId: "b", score: 10 }],
      [{ agentId: "a", score: 10 }, { agentId: "b", score: 10 }],
    ];

    const { results, summary } = await batchAblationAsync(cases, asyncDecide);
    expect(results).toHaveLength(2);
    expect(summary.cases).toBe(2);
    expect(summary.perAgentInfluence.a).toBe(0.5);
  });
});
