# Testing

Tests use Bun's built-in test runner and import `describe`, `test`, `expect`, and hooks from `bun:test`. [`bunfig.toml`](../bunfig.toml) limits discovery to `tests/`; there is no DOM environment or preload.

| Command | Behavior |
| --- | --- |
| `bun run test` | Runs all test files in parallel worker processes, with isolation between files. |
| `bun run test:ci` | Runs the same suite and stops at the first failure. |
| `bun run test:watch` | Reruns the suite when files change. |
| `bun test tests/identity.test.ts` | Runs one test file. |

Tests inside a file run sequentially. Keep shared fixtures and temporary-file cleanup local to that file; the parallel scripts isolate files, not individual tests.

- [`fixtures.ts`](../tests/fixtures.ts) generates temporary RSA keys, a local OIDC verifier, signed fixture identities, and runner labels. It never reads production credentials.
- [`identity.test.ts`](../tests/identity.test.ts) covers signature verification, token lifetime, trust restrictions, and repository claims.
- [`github.test.ts`](../tests/github.test.ts) injects fetch responses to check App JWTs, repository-scoped installation tokens, cancellation, pagination boundaries, and upstream failures.
- [`select-runner.test.ts`](../tests/select-runner.test.ts) injects the verifier, runner client, and error reporter to check request validation, the shared deadline, busy/online preference, fallback, and secret redaction.
- [`workflow.test.ts`](../tests/workflow.test.ts) parses the real reusable workflow and executes its embedded script with mocked GitHub Actions helpers and fetch responses.
- [`setup-github-app.test.ts`](../tests/setup-github-app.test.ts) covers registration data, one-time callbacks, credential handling, and configuration commands with injected functions and temporary directories.

Add focused regression tests to the matching file. Use injected clients and temporary keys instead of network requests, real App credentials, or the interactive registration helper. Restore changed globals and remove temporary files with test hooks.

Formatting, lint, type checking, and tests are separate CI steps. Run the commands in [README.md](../README.md#development-and-verification) before submitting a change.
