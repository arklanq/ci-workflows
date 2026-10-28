# Agent guide

Read [README.md](README.md) for the project's purpose, runtime, and commands. Open only the relevant guide:

- [docs/reuse.md](docs/reuse.md) maps existing modules and extension points.
- [docs/testing.md](docs/testing.md) describes fixtures and verification.

Before adding a helper or directory, inspect the existing equivalent. Keep changes scoped and update the relevant guide when documented behavior changes.

Use Bun as the package manager and runtime for development tools, tests, and production API functions. Keep `packageManager` and `engines.bun` in `package.json` aligned with `bunVersion` in `vercel.json` and the CI Bun version. Vercel selects the function runtime through `bunVersion`.

Keep API entry points thin. Reuse the existing identity verifier, GitHub client, and request error handling. Online matching self-hosted runners remain preferred while busy. Authentication and the trusted reusable workflow are documented in README.md; changes to either require matching regression coverage.

Tests use temporary keys and injected clients. Do not use real App credentials or run the registration helper to verify a code change.

Before finishing, run `bun run format:check`, `bun run lint:check`, `bun run typecheck`, and `bun run test:ci`.
