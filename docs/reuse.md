# Reuse guide

This project contains reusable GitHub Actions workflows and a small HTTP service. Reuse the existing modules before adding dependencies or infrastructure.

| Area | Existing module and responsibility |
| --- | --- |
| Public homepage. | [`public/index.html`](../public/index.html) and [`public/icon.png`](../public/icon.png) are served directly by Vercel. Keep `/` available for the homepage instead of rewriting it to the health endpoint. |
| API entry points. | [`api/`](../api/) exports Vercel HTTP handlers. Keep request logic in `src/`. |
| Workflow identity. | [`src/identity.ts`](../src/identity.ts) verifies signed GitHub OIDC claims and exports `WorkflowIdentity`, `RequestError`, and trust constants. |
| GitHub access. | [`src/github.ts`](../src/github.ts) reads App credentials and creates a runner client with an injectable fetch function. It handles installation scoping, pagination, and response validation. |
| Runner selection. | [`src/select-runner.ts`](../src/select-runner.ts) creates the request handler with injectable identity verification, runner lookup, and error reporting. It validates input and returns sanitized responses. |
| One-time setup. | [`scripts/setup-github-app.ts`](../scripts/setup-github-app.ts) handles App registration, callback validation, credential storage, and Vercel configuration. Importing it does not start registration. |
| Reusable workflow. | [`.github/workflows/select-runner.yaml`](../.github/workflows/select-runner.yaml) requests OIDC identity and retains the hosted fallback when selection fails. |
| Caller documentation. | [`workflows/select-runner/`](../workflows/select-runner/) contains the public usage guide and example. |
| Tests. | [`tests/`](../tests/) contains focused tests and shared temporary signing fixtures. See [testing.md](testing.md). |

Throw `RequestError` for expected service failures. The selection handler owns HTTP error responses and reports only sanitized status codes. Keep new request checks in that flow unless additional handlers justify shared middleware.

Use Bun for both runtime code and development scripts. The handlers in `api/` use standard Web `Request` and `Response` APIs, which also work with Bun. Add directories only when a feature needs them.
