# Select runner

The [workflow](../../.github/workflows/select-runner.yaml) selects an online self-hosted runner from the calling repository's runner list. Busy runners remain preferred; jobs queue until they are available. If no matching runner is online or the lookup fails, it returns the GitHub-hosted fallback.

The selection job runs on GitHub-hosted `ubuntu-latest`, including when the self-hosted runner is offline.

## Usage

1. Copy [example.yaml](example.yaml) to `.github/workflows/runner-fallback.yaml` in the calling repository.
2. Add `RUNNER_API_TOKEN` as an Actions secret. Use a fine-grained PAT with **Administration: Read** access to that repository.
3. Set the runner labels, replace the `linux-job` steps with your build or tests, and run the workflow manually.

The default `GITHUB_TOKEN` cannot read the runner list.

## Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `primary-runner` | `self-hosted,ubuntu-26.04-self-hosted`. | Self-hosted runner labels, comma-separated, without spaces. |
| `fallback-runner` | `ubuntu-26.04`. | One GitHub-hosted runner label. |
| `runner-api-token` secret | — | Required for runner lookup. A missing or invalid token selects the fallback. |

Output `runner` is a JSON array of labels. Parse it with `fromJSON` in `runs-on`, as shown in the example.

## Limitations

- Keep self-hosted labels distinct from GitHub-hosted image labels, as in the example.
- Label matching is case-sensitive.
- Selection does not reserve a runner. If the self-hosted runner goes offline afterward, assigned jobs will not switch to the fallback or retry automatically.
