import { describe, expect, it } from "vitest";
import { runAblation, type Finding } from "../src/index.js";

type SimpleVerdict = "auto_decline" | "auto_approve" | "escalate";

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
