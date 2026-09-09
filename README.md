# agent-ablation

[![CI](https://github.com/AyushCipher/agent-ablation/actions/workflows/ci.yml/badge.svg)](https://github.com/AyushCipher/agent-ablation/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-ablation.svg)](https://www.npmjs.com/package/agent-ablation)

Leave-one-out ablation testing, backward elimination, and ROI evaluation for multi-agent systems. You have a set of per-agent findings (scores, confidences, telemetry) and a function or model that turns those findings into a verdict. `agent-ablation` answers the key production questions:

1. **Load-Bearing Influence:** Which agents' findings actually changed the verdict, and which were along for the ride?
2. **Cost & Token ROI:** How many dollars and tokens did each specialist burn per verdict flip? Does that small accuracy bump justify the API bill?
3. **Correlated Agents & Pruning:** Which redundant agents can be safely pruned via greedy backward elimination without breaking the final verdict?
4. **Protective vs. Harmful Signals:** When ground truth is provided, did an agent's presence prevent an error (protective), or did it cause a hallucination/false positive (harmful)?
5. **Stochastic & Async LLM Judges:** Handles async decisions and repeated sampling with majority voting to filter out LLM temperature variance.

Zero runtime dependencies. Native TypeScript.

---

## Install

```bash
npm install agent-ablation
```

---

## Core Features & Usage

### 1. Basic Leave-One-Out Ablation

```typescript
import { runAblation, type Finding } from "agent-ablation";

type Verdict = "approve" | "decline" | "escalate";

function decide(findings: Finding[]): Verdict {
  const risk = 1 - findings.reduce((p, f) => p * (1 - f.score / 100), 1);
  if (risk >= 0.7) return "decline";
  if (risk <= 0.3) return "approve";
  return "escalate";
}

const findings: Finding[] = [
  { agentId: "transaction_pattern", score: 25 },
  { agentId: "identity_signal", score: 90 },
  { agentId: "network_analysis", score: 20 },
];

const result = runAblation(findings, decide);

console.log(result.baseline);        // "decline"
console.log(result.loadBearingRatio); // 0.33 (1 out of 3 agents flipped the outcome)
for (const p of result.perAgent) {
  console.log(p.removedAgentId, "->", p.verdictWithout, p.changed ? "(load-bearing)" : "");
}
```

---

### 2. Cost & Token ROI Analysis ("Cost per Verdict Flip")

Pass telemetry (`cost`, `tokens`, `latencyMs`) inside your findings. `batchAblation` computes the exact ROI metrics and identifies expensive agents with low decision impact:

```typescript
import { batchAblation, formatMarkdownReport, type Finding } from "agent-ablation";

const cases: Finding[][] = [
  [
    { agentId: "expensive_reasoner", score: 90, cost: 0.15, tokens: 3000 },
    { agentId: "cheap_heuristic", score: 10, cost: 0.002, tokens: 50 },
  ],
  [
    { agentId: "expensive_reasoner", score: 20, cost: 0.15, tokens: 3000 },
    { agentId: "cheap_heuristic", score: 85, cost: 0.002, tokens: 50 },
  ],
];

const { results, summary } = batchAblation(cases, decide);

console.log(summary.roi?.agents.expensive_reasoner.costPerVerdictFlip); // Cost per decision flip
console.log(summary.roi?.recommendations); // Automated pruning/downgrade advice

// Format into a Markdown report for PRs or documentation
console.log(formatMarkdownReport(summary));
```

---

### 3. Async & Stochastic Decision Functions (LLM-as-a-Judge)

When your decision step is an async LLM call with temperature, use `runAblationAsync` or `batchAblationAsync`. Set `samples: k` to take a majority-vote consensus across runs to eliminate sampling noise:

```typescript
import { runAblationAsync } from "agent-ablation";

async function llmSupervisorDecide(findings: Finding[]): Promise<string> {
  const res = await callLlmJudge(findings);
  return res.verdict;
}

const result = await runAblationAsync(findings, llmSupervisorDecide, {
  samples: 5, // Runs 5 samples per ablation to filter out temperature noise
});
```

---

### 4. Greedy Backward Elimination & Minimal Viable Panel

If you have correlated or redundant agents (e.g., three critics looking at the same context), simple leave-one-out might mark all of them as not load-bearing because the others compensate. 

`runBackwardElimination` iteratively eliminates agents one-by-one until removing any further agent flips the verdict, revealing the **minimal viable panel**:

```typescript
import { runBackwardElimination } from "agent-ablation";

const result = runBackwardElimination(allSpecialists, decide);

console.log(result.minimalAgentIds);   // ["critic_1", "security_auditor"]
console.log(result.eliminatedAgentIds); // ["critic_2", "critic_3", "scout_noisy"]
console.log(result.steps);             // Step-by-step elimination trace
```

For detecting 2nd-order joint dependencies, `runPairwiseAblation(findings, decide)` evaluates all pairs $(A, B)$ to catch cases where neither agent alone is load-bearing, but removing both together flips the outcome.

---

### 5. Ground-Truth & Net Accuracy Impact ("Protective vs. Harmful")

Supply ground truth labels in `batchAblation` to measure whether an agent's load-bearing presence actually **improved** accuracy or **injected errors / hallucinations**:

```typescript
const { summary } = batchAblation(cases, decide, {
  groundTruth: ["approve", "decline", "approve", "escalate"],
});

// Per-agent stats:
// - Protective: removing the agent caused a correct verdict to become incorrect
// - Harmful: removing the agent fixed an incorrect verdict
console.log(summary.perAgentStats?.["hallucinating_agent"]?.role); // "Harmful"
console.log(summary.perAgentStats?.["hallucinating_agent"]?.netAccuracyImpact); // -0.25
```

---

## Framework Adapters

Zero-dependency adapters to map telemetry and messages from popular agent frameworks directly into `Finding[]`:

### LangGraph
```typescript
import { fromLangGraphMessages } from "agent-ablation";

const findings = fromLangGraphMessages(state.messages, {
  scoreOf: (msg) => (msg.content as any).score,
  confidenceOf: (msg) => (msg.content as any).confidence,
});
```

### CrewAI
```typescript
import { fromCrewAITasks } from "agent-ablation";

const findings = fromCrewAITasks(crewOutput.tasks_output, {
  scoreOf: (task) => task.json_dict?.score ?? 0,
});
```

### AutoGen
```typescript
import { fromAutoGenMessages } from "agent-ablation";

const findings = fromAutoGenMessages(chatHistory, {
  scoreOf: (msg) => (msg.content as any).riskScore,
});
```

### Vercel AI SDK / Step Traces
```typescript
import { fromAISDKSteps } from "agent-ablation";

const findings = fromAISDKSteps(steps, {
  scoreOf: (step) => (step.result as any).score,
});
```

### Generic Custom Records
```typescript
import { fromRecords } from "agent-ablation";

const findings = fromRecords(customAuditRecords, {
  agentId: (r) => r.specialistId,
  scoreOf: (r) => r.riskScore,
  confidenceOf: (r) => r.confidenceLevel,
});
```

---

## Worked Example: SentryMesh 33% Multi-Signal Finding

[SentryMesh](https://github.com/AyushCipher/Sentry-Mesh) is a four-specialist multi-agent fraud investigation system. Its eval harness runs an ablation over its 23-case bank and reports: of 9 cases auto-resolved without human escalation, **only 3 survive removal of their single loudest specialist — 6 collapse to `escalate`.**

`tests/ablation.test.ts` reproduces all 6 cases verbatim with `agent-ablation`.

---

## Architectural Note: Leaf Ablation vs. DAG Subgraph Replay

* **Leaf Finding Ablation (This Package):** Best for **parallel / fan-out / fan-in** panels where specialists independently produce findings that feed a decision gate. Because findings are generated independently, dropping an item at `decide()` measures causal weight with **zero LLM re-invocation cost**.
* **Sequential DAG Replay:** If your pipeline is sequential (Agent A feeds intermediate prompt context to Agent B), removing Agent A at the final decision gate misses that Agent B's output already reflects Agent A. Measuring sequential pipelines requires replaying downstream subgraphs or injecting mock messages into the trace.

---

## API Summary

| Function | Description |
| :--- | :--- |
| `runAblation(findings, decide, equals?)` | Synchronous leave-one-out ablation for a single case. |
| `runAblationAsync(findings, decide, options?)` | Async leave-one-out ablation with optional $K$-sampling / majority voting. |
| `batchAblation(cases, decide, options?)` | Batch ablation with telemetry ROI and ground-truth metrics. |
| `batchAblationAsync(cases, decide, options?)` | Async batch ablation. |
| `runBackwardElimination(findings, decide, equals?)` | Greedy backward elimination to find the minimal agent panel. |
| `runPairwiseAblation(findings, decide, equals?)` | Evaluates all 2-agent pairs to detect interaction/redundancy effects. |
| `formatMarkdownReport(summary, options?)` | Formats summary into a GitHub/Dev.to markdown report with ROI tables. |
| `formatAsciiTable(summary)` | Formats summary into a clean terminal ASCII table. |
| `fromLangGraphMessages(...)` | Adapter for LangGraph message arrays. |
| `fromCrewAITasks(...)` | Adapter for CrewAI task outputs. |
| `fromAutoGenMessages(...)` | Adapter for AutoGen chat histories. |
| `fromAISDKSteps(...)` | Adapter for Vercel AI SDK step traces. |
| `fromRecords(...)` | Generic record mapper. |

---

## License

MIT © Ayush Verma — ayushv3533e@gmail.com
