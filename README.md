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

`GET /api/health` reports whether App credentials are configured without returning their values. The service runs as Node.js 24 Vercel Functions in Frankfurt, with a 30-second function limit and bounded GitHub requests. No database is required.

Production requires only these environment variables:

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | App identifier, stored as Vercel Config. |
| `GITHUB_APP_PRIVATE_KEY` | Multiline RSA private key, stored as a Vercel Secret. |

The setup helper writes these variables through stdin and retains a private, ignored recovery file only until deployment succeeds. Keep production credentials out of Preview environments, source control, logs, and browser responses.

## Development and verification

```sh
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run test
```

Tests sign fixture OIDC tokens and App JWTs with temporary RSA keys, mock GitHub responses, and check authorization failures, repository scoping, pagination, online/busy selection, hosted fallback, response limits, secret redaction, and one-time setup handling. They do not require real credentials or change runner state.
