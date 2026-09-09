import { describe, expect, it } from "vitest";
import { batchAblation, type Finding } from "../src/index.js";

describe("Telemetry ROI & Ground-Truth Net Accuracy", () => {
  it("computes costPerVerdictFlip, costShare, and pruning recommendations", () => {
    const decide = (findings: Finding[]) =>
      findings.some((f) => f.score >= 80) ? "action" : "ignore";

    // 4 cases:
    // expensive_specialist costs $0.10, scores high only in case 1 (flips 1 case).
    // cheap_heuristic costs $0.001, scores high in cases 2 and 3 (flips 2 cases).
    const cases: Finding[][] = [
      [
        { agentId: "expensive_specialist", score: 90, cost: 0.10, tokens: 2000 },
        { agentId: "cheap_heuristic", score: 10, cost: 0.001, tokens: 20 },
      ],
      [
        { agentId: "expensive_specialist", score: 20, cost: 0.10, tokens: 2000 },
        { agentId: "cheap_heuristic", score: 85, cost: 0.001, tokens: 20 },
      ],
      [
        { agentId: "expensive_specialist", score: 15, cost: 0.10, tokens: 2000 },
        { agentId: "cheap_heuristic", score: 90, cost: 0.001, tokens: 20 },
      ],
      [
        { agentId: "expensive_specialist", score: 10, cost: 0.10, tokens: 2000 },
        { agentId: "cheap_heuristic", score: 10, cost: 0.001, tokens: 20 },
      ],
    ];

    const { summary } = batchAblation(cases, decide);

    expect(summary.roi).toBeDefined();
    const expRoi = summary.roi!.agents.expensive_specialist!;
    const cheapRoi = summary.roi!.agents.cheap_heuristic!;

    // expensive: $0.40 total cost across 4 runs, 1 flip -> $0.40 / flip
    expect(expRoi.totalCost).toBeCloseTo(0.40);
    expect(expRoi.costPerVerdictFlip).toBeCloseTo(0.40);
    expect(expRoi.costShare).toBeGreaterThan(0.95);

    // cheap: $0.004 total cost across 4 runs, 2 flips -> $0.002 / flip
    expect(cheapRoi.totalCost).toBeCloseTo(0.004);
    expect(cheapRoi.costPerVerdictFlip).toBeCloseTo(0.002);
    expect(cheapRoi.efficiencyRatio).toBeGreaterThan(10);
  });

  it("calculates Ground Truth accuracy and distinguishes Protective vs Harmful agents", () => {
    // Decision logic
    const decide = (findings: Finding[]) =>
      findings.some((f) => f.score >= 50) ? "approve" : "decline";

    // 2 cases:
    // Case 1: GT is "approve". Good agent scored 80, Hallucinating agent scored 10. Baseline "approve".
    // Removing Good agent -> flips to "decline" (error introduced -> Protective).
    // Case 2: GT is "decline". Good agent scored 10, Hallucinating agent scored 90 (hallucinated!). Baseline is "approve" (wrong!).
    // Removing Hallucinating agent -> changes baseline to "decline" (matches GT -> Corrective!).
    const cases: Finding[][] = [
      [
        { agentId: "good_specialist", score: 80 },
        { agentId: "hallucinator", score: 10 },
      ],
      [
        { agentId: "good_specialist", score: 10 },
        { agentId: "hallucinator", score: 90 },
      ],
    ];

    const groundTruth: ("approve" | "decline")[] = ["approve", "decline"];

    const { summary } = batchAblation(cases, decide, { groundTruth });

    expect(summary.accuracy).toBeDefined();
    expect(summary.accuracy?.baselineAccuracy).toBe(0.5); // 1 out of 2 correct initially

    const goodStats = summary.perAgentStats?.good_specialist;
    const badStats = summary.perAgentStats?.hallucinator;

    expect(goodStats?.protectiveFlips).toBe(1);
    expect(goodStats?.correctiveFlips).toBe(0);
    expect(goodStats?.role).toBe("Protective");

    expect(badStats?.protectiveFlips).toBe(0);
    expect(badStats?.correctiveFlips).toBe(1);
    expect(badStats?.role).toBe("Harmful");
  });
});
