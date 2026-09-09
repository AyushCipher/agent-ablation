import { describe, expect, it } from "vitest";
import {
  batchAblation,
  formatAsciiTable,
  formatMarkdownReport,
  fromAISDKSteps,
  fromAutoGenMessages,
  fromCrewAITasks,
  type Finding,
} from "../src/index.js";

describe("New Framework Adapters", () => {
  it("converts CrewAI task outputs correctly", () => {
    const outputs = [
      {
        agent: "Senior Researcher",
        raw: "Detailed analysis complete",
        json_dict: { score: 88, confidence: 0.95 },
        cost: 0.02,
        tokens: 500,
      },
      {
        agent: { role: "Fact Checker" },
        score: 30,
      },
    ];

    const findings = fromCrewAITasks(outputs);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.agentId).toBe("Senior Researcher");
    expect(findings[0]?.score).toBe(88);
    expect(findings[0]?.confidence).toBe(0.95);
    expect(findings[0]?.cost).toBe(0.02);
    expect(findings[0]?.tokens).toBe(500);

    expect(findings[1]?.agentId).toBe("Fact Checker");
    expect(findings[1]?.score).toBe(30);
  });

  it("converts AutoGen message histories correctly", () => {
    const messages = [
      {
        name: "code_reviewer",
        content: { score: 92, status: "passed" },
      },
      {
        role: "security_auditor",
        content: "No vulnerabilities found",
      },
    ];

    const findings = fromAutoGenMessages(messages, {
      scoreOf: (msg) =>
        typeof msg.content === "object" && msg.content !== null && "score" in msg.content
          ? Number((msg.content as Record<string, unknown>).score)
          : 15,
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.agentId).toBe("code_reviewer");
    expect(findings[0]?.score).toBe(92);
    expect(findings[1]?.agentId).toBe("security_auditor");
    expect(findings[1]?.score).toBe(15);
  });

  it("converts Vercel AI SDK step and tool trace results", () => {
    const steps = [
      {
        toolName: "database_lookup",
        result: { matchScore: 90 },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        latencyMs: 120,
      },
    ];

    const findings = fromAISDKSteps(steps, {
      scoreOf: (step) =>
        typeof step.result === "object" && step.result !== null && "matchScore" in step.result
          ? Number((step.result as Record<string, unknown>).matchScore)
          : 0,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.agentId).toBe("database_lookup");
    expect(findings[0]?.score).toBe(90);
    expect(findings[0]?.tokens).toBe(150);
    expect(findings[0]?.latencyMs).toBe(120);
  });
});

describe("Reporters (Markdown & ASCII)", () => {
  it("formats Markdown and ASCII reports accurately", () => {
    const cases: Finding[][] = [
      [
        { agentId: "agent_alpha", score: 80, cost: 0.05, tokens: 1000 },
        { agentId: "agent_beta", score: 10, cost: 0.01, tokens: 200 },
      ],
      [
        { agentId: "agent_alpha", score: 20, cost: 0.05, tokens: 1000 },
        { agentId: "agent_beta", score: 10, cost: 0.01, tokens: 200 },
      ],
    ];

    const { summary } = batchAblation(
      cases,
      (fs) => (fs.some((f) => f.score >= 50) ? "pass" : "fail"),
      { groundTruth: ["pass", "fail"] }
    );

    const mdReport = formatMarkdownReport(summary, { title: "CI Pipeline Eval" });
    const asciiTable = formatAsciiTable(summary);

    expect(mdReport).toContain("# CI Pipeline Eval");
    expect(mdReport).toContain("agent_alpha");
    expect(mdReport).toContain("agent_beta");
    expect(mdReport).toContain("Cost & Telemetry ROI Analysis");

    expect(asciiTable).toContain("AGENT ABLATION SUMMARY");
    expect(asciiTable).toContain("agent_alpha");
  });
});
