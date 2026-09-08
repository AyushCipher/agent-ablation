# Contributing to agent-ablation

Thank you for your interest in contributing to `agent-ablation`! We welcome contributions, bug fixes, and improvements.

## Development Workflow

1. **Fork and Clone**: Fork the repository on GitHub and clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/agent-ablation.git
   cd agent-ablation
   ```

2. **Branch**: Create a descriptive feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Verify Changes**: Before submitting your changes, ensure all checks pass:
   ```bash
   npm run typecheck   # Type check with TypeScript
   npm test            # Run Vitest test suite
   npm run build       # Build ESM, CJS, and DTS bundles
   ```

5. **Submit a Pull Request**: Push your branch to GitHub and open a Pull Request targeting the `main` branch.

## Guidelines

- **Zero Runtime Dependencies**: `agent-ablation` is strictly dependency-free at runtime. New features and adapters should use structural typing rather than importing external frameworks.
- **Tests & Documentation**: Please include tests for new functionality in `tests/` and update `README.md` and TSDoc comments where applicable.
