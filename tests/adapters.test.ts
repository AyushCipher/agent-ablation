import { describe, expect, it } from "vitest";
import {
  fromLangGraphMessages,
  fromRecords,
  runAblation,
  type Finding,
  type LangGraphAgentMessage,
} from "../src/index.js";

describe("fromLangGraphMessages", () => {
  it("converts named messages correctly using scoreOf", () => {
    const messages: LangGraphAgentMessage[] = [
      {
        name: "fraud_detector",
        content: { score: 85, reason: "suspicious IP" },
      },
      {
        name: "kyc_verifier",
        content: "Identity check passed",
        risk: 40,
      },
    ];

    const findings = fromLangGraphMessages(messages, {
      scoreOf: (msg) =>
        typeof msg.content === "object" && msg.content !== null && "score" in msg.content
          ? Number((msg.content as Record<string, unknown>).score)
          : Number(msg.risk ?? 0),
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      agentId: "fraud_detector",
      score: 85,
      metadata: { score: 85, reason: "suspicious IP" },
    });
    expect(findings[1]).toEqual({
      agentId: "kyc_verifier",
      score: 40,
      metadata: { raw: "Identity check passed" },
    });
  });

  it("skips unnamed messages and messages with invalid names", () => {
    const messages: LangGraphAgentMessage[] = [
      {
        content: "Human message with no name",
      },
      {
        name: "",
        content: "Empty name message",
      },
      {
        name: "   ",
        content: "Whitespace name message",
      },
      {
        name: null,
        content: "Null name message",
      },
      {
        name: "valid_agent",
        score: 95,
        content: "Valid finding",
      },
    ];

    const findings = fromLangGraphMessages(messages, {
      scoreOf: (msg) => Number(msg.score ?? 0),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.agentId).toBe("valid_agent");
    expect(findings[0]?.score).toBe(95);
  });

  it("preserves object content directly as metadata and wraps string content inside { raw: content }", () => {
    const messages: LangGraphAgentMessage[] = [
      {
        name: "object_agent",
        content: { risk: "high", flags: ["vpn", "tor"], score: 90 },
      },
      {
        name: "string_agent",
        content: "clean transaction history",
      },
    ];

    const findings = fromLangGraphMessages(messages, {
      scoreOf: (msg) =>
        typeof msg.content === "object" && msg.content !== null && "score" in msg.content
          ? Number((msg.content as Record<string, unknown>).score)
          : 10,
    });

    expect(findings[0]?.metadata).toEqual({
      risk: "high",
      flags: ["vpn", "tor"],
      score: 90,
    });
    expect(findings[1]?.metadata).toEqual({
      raw: "clean transaction history",
    });
  });

  it("handles confidenceOf mapping", () => {
    const messages: LangGraphAgentMessage[] = [
      {
        name: "agent_with_confidence",
        content: { score: 70, confidence: 0.85 },
      },
      {
        name: "agent_without_confidence",
        content: { score: 30 },
      },
    ];

    const findings = fromLangGraphMessages(messages, {
      scoreOf: (msg) => Number((msg.content as Record<string, unknown>).score),
      confidenceOf: (msg) =>
        "confidence" in (msg.content as Record<string, unknown>)
          ? Number((msg.content as Record<string, unknown>).confidence)
          : undefined,
    });

    expect(findings[0]?.confidence).toBe(0.85);
    expect(findings[1]?.confidence).toBeUndefined();
  });

  it("integrates seamlessly with runAblation", () => {
    const stateMessages: LangGraphAgentMessage[] = [
      { name: "fraud_detector", score: 80, content: "high risk" },
      { name: "sanctions_check", score: 10, content: "clear" },
      { name: "device_reputation", score: 15, content: "normal" },
    ];

    const findings = fromLangGraphMessages(stateMessages, {
      scoreOf: (msg) => Number(msg.score),
    });

    const decide = (fs: Finding[]) => (fs.some((f) => f.score >= 50) ? "flag" : "clear");
    const result = runAblation(findings, decide);

    expect(result.baseline).toBe("flag");
    expect(result.loadBearingCount).toBe(1);
    expect(result.perAgent.find((p) => p.removedAgentId === "fraud_detector")?.changed).toBe(true);
  });
});

describe("fromRecords", () => {
  interface CustomAuditRecord {
    evaluator: string;
    riskScore: number;
    certainty?: number;
    auditLog: string;
  }

  it("maps generic records correctly with callbacks", () => {
    const records: CustomAuditRecord[] = [
      {
        evaluator: "eval_alpha",
        riskScore: 65,
        certainty: 0.92,
        auditLog: "Found suspicious header",
      },
      {
        evaluator: "eval_beta",
        riskScore: 20,
        auditLog: "Clean payload",
      },
    ];

    const findings = fromRecords(records, {
      agentId: (r) => r.evaluator,
      scoreOf: (r) => r.riskScore,
      confidenceOf: (r) => r.certainty,
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.agentId).toBe("eval_alpha");
    expect(findings[0]?.score).toBe(65);
    expect(findings[0]?.confidence).toBe(0.92);

    expect(findings[1]?.agentId).toBe("eval_beta");
    expect(findings[1]?.score).toBe(20);
    expect(findings[1]?.confidence).toBeUndefined();
  });

  it("preserves the original record in metadata", () => {
    const records = [
      { service: "auth", points: 100, timestamp: 1670000000 },
      { service: "billing", points: 45, timestamp: 1670000001 },
    ];

    const findings = fromRecords(records, {
      agentId: (r) => r.service,
      scoreOf: (r) => r.points,
    });

    expect(findings[0]?.metadata).toEqual({
      service: "auth",
      points: 100,
      timestamp: 1670000000,
    });
    expect(findings[1]?.metadata).toEqual({
      service: "billing",
      points: 45,
      timestamp: 1670000001,
    });
  });
});
