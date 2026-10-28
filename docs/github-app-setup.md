# GitHub App setup

The runner-selection service keeps one GitHub App private key in Vercel. Calling repositories authenticate with GitHub Actions OIDC and do not need a PAT or repository secret.

## One-time setup

1. Install Bun and Vercel CLI, run `vercel login`, and link this checkout to the `ci-workflows` Vercel project in `arkadiusz-nurzyskis-projects`.
2. Install the repository dependencies with `bun install --frozen-lockfile`.
3. Run `bun run setup:app`. For a different production origin, follow [Changing the service origin](#changing-the-service-origin) before registering the App.
4. The helper opens GitHub in your browser. While logged in as `arklanq`, approve **Create GitHub App**. GitHub lets you change the suggested name `arklanq-ci-runner` if it is already taken. The registration is private, requests repository **Administration: Read** and **Metadata: Read**, and disables webhook delivery and OAuth authorization on installation.
5. Keep the terminal open. The helper exchanges GitHub's temporary code, saves the App ID and private key in the linked Vercel project's production environment, and deploys the service again. It does not display the private key or pass it as a process argument.
6. A GitHub installation page opens. Install the App on `arklanq`, choosing **All repositories** or the specific repositories that should use the service.

GitHub requires the owner to approve both App creation and installation. These browser approvals cannot be replaced by the setup helper.

The variables written by the helper are `GITHUB_APP_ID` (Config) and `GITHUB_APP_PRIVATE_KEY` (Secret), both scoped to Production. The App's private key has no automatic expiration. It must still be kept secure and can be replaced in the GitHub App settings if needed.

## Interrupted setup

The helper stores the registration credentials temporarily in the ignored `.local/github-app.json` file, with directory permissions `0700` and file permissions `0600`. It removes this file after the Vercel deployment succeeds. Never commit or share this file.

If Vercel configuration or deployment fails after registration, fix the Vercel login or project configuration and run:

```sh
bun run setup:app -- --resume
```

This reuses the saved registration and opens the installation page after deployment. It does not create another GitHub App. If the manifest exchange itself failed, no usable credentials have been received; restart setup and review the App registrations in GitHub before creating another App.

The callback server listens only on `127.0.0.1`, checks a random one-time state, rejects duplicate callbacks, and stops accepting callbacks after ten minutes.

## Changing the service origin

`--service-url https://your-service.example` changes only the service origin in the GitHub App registration manifest. It does not reconfigure the reusable workflow or its OIDC audience.

Before registering the App for another origin:

1. Update `RUNNER_SERVICE_URL` in [the reusable workflow](../.github/workflows/select-runner.yaml) to the new origin followed by `/api/select-runner`.
2. Set the workflow's `core.getIDToken(...)` audience and `oidcAudience` in [the identity verifier](../src/identity.ts) to that same origin, without a trailing slash or endpoint path.
3. Update the corresponding fixed-origin expectations in [workflow.test.ts](../tests/workflow.test.ts), run the checks in [README.md](../README.md#development-and-verification), and deploy the service and trusted workflow together.
4. Run `bun run setup:app -- --service-url https://your-service.example` against the linked Vercel project.

The audience must match on both sides. Keep the existing owner and trusted-workflow restrictions when changing only the service origin.

## Additional repositories

Add the reusable `select-runner` job to the repository's CI workflow and grant that job `id-token: write`. If the App installation uses **Only select repositories**, add the repository to that installation. No PAT update or repository secret is required.

The installation can be changed under [Installed GitHub Apps](https://github.com/settings/installations). Select the runner-selection App and click **Configure**.

## References

- [GitHub App manifest registration flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest).
- [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).
- [Managing GitHub App private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).
