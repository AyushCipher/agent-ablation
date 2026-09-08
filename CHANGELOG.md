# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions CI workflow running across Node.js 20 and 22
- CI status and npm version badges in README
- Contributor guide (`CONTRIBUTING.md`)
- Comprehensive TSDoc documentation for all exported types and functions

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
