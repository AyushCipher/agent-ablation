# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-09

### Added
- **Async & Stochastic `decide()` Support**: `runAblationAsync` and `batchAblationAsync` with native Promise support.
- **$K$-Repeat & Majority Voting**: `samples: k` option and `majorityVote` cluster consensus resolver to filter out LLM temperature variance.
- **Greedy Backward Elimination**: `runBackwardElimination` and `runBackwardEliminationAsync` to prune redundant agents and determine the minimal viable panel.
- **Pairwise Interaction Ablation**: `runPairwiseAblation` to detect 2nd-order joint dependencies where removing two agents together flips decisions.
- **Token & Cost ROI Engine**: Compute `costPerVerdictFlip`, `tokensPerVerdictFlip`, `costShare`, and automated pruning recommendations.
- **Ground-Truth & Net Accuracy Analysis**: Classify agent impact as `Protective`, `Harmful`, or `Neutral` based on whether removal prevents or causes mistakes.
- **Framework Adapters**:
  - `fromCrewAITasks` for CrewAI task outputs and roles
  - `fromAutoGenMessages` for AutoGen chat conversation histories
  - `fromAISDKSteps` for Vercel AI SDK step/tool execution traces
- **Visual & Terminal Formatters**: `formatMarkdownReport` (Markdown with tables and badges) and `formatAsciiTable` (terminal logs).

## [0.2.0] - 2026-09-08

### Added
- LangGraph adapter (`fromLangGraphMessages`) for mapping agent message history to findings
- Generic `fromRecords()` adapter for arbitrary trace structures
- Dedicated adapter unit test suite
- LangGraph integration documentation and examples in README

### Changed
- Improved TypeScript typings and structural compatibility

## [0.1.0] - 2026-08-08

### Added
- Core leave-one-out ablation engine (`runAblation`)
- Batch case ablation aggregator (`batchAblation`)
- SentryMesh fraud benchmark reproduction test suite
- Full ESM, CommonJS, and TypeScript declaration builds
