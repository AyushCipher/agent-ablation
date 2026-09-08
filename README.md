# agent-ablation

[![CI](https://github.com/AyushCipher/agent-ablation/actions/workflows/ci.yml/badge.svg)](https://github.com/AyushCipher/agent-ablation/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-ablation.svg)](https://www.npmjs.com/package/agent-ablation)

Leave-one-out ablation testing for multi-agent decision systems. You have a set of
per-agent findings (scores, confidences, whatever your pipeline produces) and a
function that turns those findings into a verdict. `agent-ablation` answers one
question: **which of my agents' findings actually changed that verdict, and which
were along for the ride?**

It removes each finding one at a time, re-runs your decision function on what's
left, and reports which removals flipped the outcome. Zero runtime dependencies,
zero opinions about how your agents work — you supply the findings and the
decision function, it does the leave-one-out loop and the bookkeeping.

## Install

```bash
npm install agent-ablation
```

## Quick example

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
console.log(result.loadBearingRatio); // fraction of agents whose removal changed the verdict
for (const p of result.perAgent) {
  console.log(p.removedAgentId, "->", p.verdictWithout, p.changed ? "(load-bearing)" : "");
}
```

For a batch of cases, `batchAblation` runs the same ablation over each one and
aggregates the results — including, per agent, the fraction of cases in which
removing that agent changed the outcome:

```typescript
import { batchAblation } from "agent-ablation";

const { results, summary } = batchAblation(allCases, decide);

console.log(summary.averageLoadBearingRatio);
console.log(summary.perAgentInfluence); // { transaction_pattern: 0.17, identity_signal: 0.83, ... }
```

## Using with LangGraph

If you are orchestrating multi-agent systems with LangGraph, `fromLangGraphMessages` provides a zero-dependency convenience mapper for common LangGraph message shapes (this is a structural mapper, not an official LangGraph integration). It extracts named agent messages from `state.messages` and converts them into `Finding[]`:

```typescript
import { runAblation, fromLangGraphMessages, type Finding } from "agent-ablation";

// In your LangGraph supervisor node / decision step:
function evaluateState(state: { messages: any[] }) {
  // Maps named specialist messages to Finding[]
  const findings = fromLangGraphMessages(state.messages, {
    scoreOf: (msg) => (msg.content as any).score,
    confidenceOf: (msg) => (msg.content as any).confidence,
  });

  const decide = (fs: Finding[]) => {
    const risk = 1 - fs.reduce((p, f) => p * (1 - f.score / 100), 1);
    return risk >= 0.7 ? "decline" : "approve";
  };

  const result = runAblation(findings, decide);
  return result;
}
```

For arbitrary custom structures or telemetry traces, `fromRecords()` is also available to map any record array with custom extraction callbacks:

```typescript
import { fromRecords } from "agent-ablation";

const findings = fromRecords(customAuditRecords, {
  agentId: (r) => r.specialistId,
  scoreOf: (r) => r.riskScore,
  confidenceOf: (r) => r.confidenceLevel, // optional
});
```

## Worked example: reproducing SentryMesh's 33% multi-signal-share finding

[SentryMesh](https://github.com/AyushCipher/Sentry-Mesh) is a four-specialist
multi-agent fraud investigation system. Its own eval harness runs an ablation over
its 23-case bank and reports the result plainly in its README: of 9 cases the
system auto-resolved without escalating to a human, **only 3 survive removal of
their single loudest specialist — 6 collapse to `escalate`.** SentryMesh calls
this "the most important number in the report," because it means two-thirds of
those auto-decisions rested on one specialist's finding, with the other three
specialists' LLM calls spent for nothing.

Those six cases, straight from SentryMesh's ablation table:

| Case | Decision | Remove | Becomes |
|---|---|---|---|
| SM-001 | auto_decline | `identity_signal` (100) | escalate |
| SM-002 | auto_decline | `identity_signal` (75) | escalate |
| SM-005 | auto_decline | `identity_signal` (80) | escalate |
| SM-006 | auto_decline | `identity_signal` (70) | escalate |
| SM-012 | auto_decline | `network_analysis` (90) | escalate |
| SM-016 | auto_approve | `transaction_pattern` (26) | escalate |

`tests/ablation.test.ts` in this repo reproduces all six as a worked example: it
builds each case's four-specialist `Finding[]` (with the named specialist's score
matching SentryMesh's table exactly), runs it through a decision function modeled
on SentryMesh's own description of its aggregation — findings combine via
noisy-OR, gated by panel confidence — and asserts that `runAblation` correctly
identifies the named specialist's removal as the one that flips each case to
`escalate`. It's the credibility anchor for this package: if `agent-ablation`
couldn't reproduce a real, previously-published ablation result on real case
data, it wouldn't be trustworthy on your data either.

## Limitations

**This tool detects verdict *change*, not verdict quality.** A flipped verdict
after removing an agent tells you that agent was load-bearing for that decision —
it says nothing about whether the original verdict or the post-removal one was
*correct*. Conversely, a low `loadBearingRatio` is not automatically a flaw:
redundancy across agents can be exactly what you want (independent corroboration
is the point of running more than one specialist), and this tool has no way to
distinguish "healthy redundancy" from "wasted compute" for you.

**Leave-one-out misses agents that only matter in pairs.** This is a real gap,
not a hedge. If removing agent A alone doesn't flip the verdict, and removing
agent B alone doesn't either, but removing *both together* would, leave-one-out
ablation will report both as not load-bearing. Catching that requires ablating
combinations, which this package deliberately does not do — the combinatorics
blow up fast, and a leave-one-out pass over a modest agent panel is already the
useful 80% case. If you suspect joint effects, ablate the suspected pair
manually by filtering `findings` yourself before calling `decide`.

**`decide()` must be pure and deterministic.** `runAblation` calls `decide` once
per finding removed, expecting each call to depend only on the findings it's
given. If your decision logic calls an LLM internally, this tool does not apply
to that call — it only makes sense as a probe over a deterministic aggregation
step that runs *after* the LLM reasoning is done. This mirrors SentryMesh's own
architecture: its supervisor's model call interprets *why* specialists conflict
and produces a combined risk and confidence, but turning those numbers into an
auto-decline/auto-approve/escalate action is `decide()`, a pure function with no
model call in it — "an LLM is a good place for the interpretation and a bad place
for a threshold that compliance will one day have to explain in writing," in
SentryMesh's own words. `agent-ablation` ablates that downstream pure function,
not the LLM call that fed it.

## API reference

```typescript
interface Finding {
  agentId: string;
  score: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

type DecisionFn<TVerdict> = (findings: Finding[]) => TVerdict;

interface PerAgentAblation<TVerdict> {
  removedAgentId: string;
  verdictWithout: TVerdict;
  changed: boolean;
}

interface AblationResult<TVerdict> {
  baseline: TVerdict;
  perAgent: PerAgentAblation<TVerdict>[];
  loadBearingCount: number;
  totalAgents: number;
  loadBearingRatio: number;
}

function runAblation<TVerdict>(
  findings: Finding[],
  decide: DecisionFn<TVerdict>,
  equals?: (a: TVerdict, b: TVerdict) => boolean
): AblationResult<TVerdict>;

interface BatchAblationSummary {
  cases: number;
  averageLoadBearingRatio: number;
  perAgentInfluence: Record<string, number>;
}

function batchAblation<TVerdict>(
  cases: Finding[][],
  decide: DecisionFn<TVerdict>,
  equals?: (a: TVerdict, b: TVerdict) => boolean
): { results: AblationResult<TVerdict>[]; summary: BatchAblationSummary };

interface LangGraphAgentMessage {
  name?: string | null;
  content?: unknown;
  [key: string]: unknown;
}

interface LangGraphAdapterOptions<TMessage extends LangGraphAgentMessage = LangGraphAgentMessage> {
  scoreOf: (message: TMessage) => number;
  confidenceOf?: (message: TMessage) => number | undefined;
}

function fromLangGraphMessages<TMessage extends LangGraphAgentMessage = LangGraphAgentMessage>(
  messages: readonly TMessage[] | TMessage[],
  options: LangGraphAdapterOptions<TMessage>
): Finding[];

function fromRecords<T>(
  records: readonly T[] | T[],
  options: {
    agentId: (record: T, index: number) => string;
    scoreOf: (record: T, index: number) => number;
    confidenceOf?: (record: T, index: number) => number | undefined;
  }
): Finding[];
```

`equals` defaults to `===`. If `TVerdict` is an object (or anything else compared
by reference rather than value), you must supply your own `equals` — otherwise
every ablation will read as "changed" purely because two structurally identical
verdict objects are never `===` to each other, regardless of whether the
decision actually differed.

## License

MIT

---

Ayush Verma — ayushv3533e@gmail.com
