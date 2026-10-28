# Select runner

The [workflow](../../.github/workflows/select-runner.yaml) asks the central GitHub App service to select an online self-hosted runner from the calling repository's runner list. Busy runners remain preferred; jobs queue until they are available. If no matching runner is online or the lookup fails, it returns the GitHub-hosted fallback.

The selection job runs on GitHub-hosted `ubuntu-latest`, including when the self-hosted runner is offline.

## Usage

1. Copy [example.yaml](example.yaml) to `.github/workflows/runner-fallback.yaml` in the calling repository.
2. Ensure the central GitHub App installation has access to that repository. Account-wide installation covers all repositories; a selected installation must include each project.
3. Grant `id-token: write` to the job calling this workflow, as in the example.
4. Set the runner labels, replace the `linux-job` steps with your build or tests, and run the workflow manually.

No PAT or repository secret is needed. The selection job obtains a short-lived GitHub Actions OIDC token with audience `https://github.com/arklanq/ci-workflows` and sends it to the service. The service validates the identity and uses its GitHub App credentials to read the caller's runner list. The application private key stays in the service.

The default `GITHUB_TOKEN` cannot read the runner list. Both the caller and reusable workflow grant `id-token: write`; GitHub rejects callers that do not grant this required permission. Token acquisition failures, rejected identities, network errors, and malformed service responses select the fallback with a warning identifying the failing stage. Runner selection never checks out or executes code from the caller's repository.

## Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `primary-runner` | `self-hosted,ubuntu-26.04-self-hosted`. | Self-hosted runner labels, comma-separated, without spaces. |
| `fallback-runner` | `ubuntu-26.04`. | One GitHub-hosted runner label. |

Output `runner` is a JSON array of labels. Parse it with `fromJSON` in `runs-on`, as shown in the example.

## Limitations

- Keep self-hosted labels distinct from GitHub-hosted image labels, as in the example.
- Label matching is case-sensitive.
- The central GitHub App service must be configured and installed before self-hosted selection works. Until then, callers use the hosted fallback.
- Existing callers must remove the `runner-api-token` secret mapping and grant `id-token: write` when upgrading from the PAT-based workflow.
- Selection does not reserve a runner. If the self-hosted runner goes offline afterward, assigned jobs will not switch to the fallback or retry automatically.
