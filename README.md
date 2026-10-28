# CI Workflows

Shared GitHub Actions workflows and a central GitHub App service for projects under the `arklanq` account. Calling repositories authenticate with GitHub Actions OIDC and do not need personal access tokens or repository secrets.

| Workflow | Description | Example |
| --- | --- | --- |
| [Select runner](workflows/select-runner/README.md) | Prefers an online self-hosted runner and falls back to a GitHub-hosted runner. | [example.yaml](workflows/select-runner/example.yaml). |

## GitHub App setup

Follow the [one-time setup guide](docs/github-app-setup.md). The helper registers a private App through GitHub's browser approval flow, stores its credentials in Vercel, and opens the installation page. Install it on `arklanq` with access to all repositories or selected projects.

New callers only add the reusable workflow and grant its selection job `id-token: write`. With a selected-repositories installation, also add the repository to the App installation. No per-repository secrets are required.

## Service

`POST /api/select-runner` accepts a GitHub Actions OIDC bearer token and a JSON body containing `primaryRunner` and `fallbackRunner`. It returns `{ "runner": ["label"] }`. The workflow retains the hosted fallback if authentication, configuration, or GitHub access fails.

The service verifies GitHub's RS256 signature, issuer, audience, token lifetime, immutable owner ID, repository ID, and the trusted reusable workflow. Only GitHub-hosted jobs using `arklanq/ci-workflows/.github/workflows/select-runner.yaml@refs/heads/main` for owner ID `23725071` are accepted. The repository is taken from signed claims, never from the request body. This deliberately excludes unmerged workflow branches.

The App installation must belong to the same owner. Each installation token is restricted to the caller's repository ID and read-only administration access. The service reads up to 1,000 runners with pagination, prefers matching online runners even while busy, and returns only the selected labels. It never returns App credentials or installation tokens. Responses are not cached.

Selection has a shared 8-second budget, starting before identity verification, and each GitHub API request is limited to 5 seconds. Request-body reads and GitHub lookups are cancelled when the budget expires or the caller disconnects. This leaves time to respond before the workflow's 10-second service timeout.

`GET /api/health` reports whether App credentials are configured without returning their values. The service is configured for Bun 1.4 Vercel Functions in Frankfurt, with a 30-second function limit. No database is required.

[`bunVersion: "1.4.x"`](https://vercel.com/docs/functions/runtimes/bun) in `vercel.json` selects the production runtime; Vercel manages its patch version. Vercel currently labels the Bun runtime as Beta.

Production requires only these environment variables:

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | App identifier, stored as Vercel Config. |
| `GITHUB_APP_PRIVATE_KEY` | Multiline RSA private key, stored as a Vercel Secret. |

The setup helper writes these variables through stdin and retains a private, ignored recovery file only until deployment succeeds. Keep production credentials out of Preview environments, source control, logs, and browser responses.

## Development and verification

Bun 1.4.4 installs dependencies and runs development tools, formatting, type checking, and tests. Keep `packageManager` and `engines.bun` aligned with the production Bun 1.4 runtime and the CI version.

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint:check
bun run typecheck
bun run test:ci
```

Use `bun run format` and `bun run lint` to apply fixes. `bun run test` runs the full suite with isolated parallel files; `bun run test:watch` reruns it while editing. CI runs the checks above without changing source files and stops tests at the first failure.

`bun run updates:check` lists dependency updates compatible with installed peer requirements. `bun run updates:force` writes those versions to `package.json`; follow it with `bun install` and the checks above before keeping the changes.

See [the reuse guide](docs/reuse.md) for existing modules, [testing](docs/testing.md) for fixtures and test conventions, and [AGENTS.md](AGENTS.md) for agent instructions.
