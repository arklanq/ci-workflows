import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import {
  RequestError,
  trustedOwnerId,
  type WorkflowIdentity,
} from "./identity.js";

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

export interface Runner {
  status: string;
  busy?: boolean;
  labels: { name: string }[];
}

export function readAppCredentials(): AppCredentials {
  const appId = process.env["GITHUB_APP_ID"];
  const privateKey = process.env["GITHUB_APP_PRIVATE_KEY"];
  if (!appId || !privateKey) {
    throw new RequestError(503, "GitHub App is not configured.");
  }
  return { appId, privateKey };
}

type Fetch = (url: string, options: RequestInit) => Promise<Response>;

export function createGitHubRunnerClient(
  credentials: AppCredentials,
  send: Fetch = fetch,
) {
  async function request(
    path: string,
    token: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const response = await send(`https://api.github.com${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "arklanq-ci-runner",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      redirect: "error",
    });
    if (!response.ok) {
      throw new RequestError(503, "GitHub runner lookup is unavailable.");
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new RequestError(503, "GitHub returned an invalid response.");
    }
    return data as Record<string, unknown>;
  }

  return async (
    identity: WorkflowIdentity,
    signal: AbortSignal,
  ): Promise<Runner[]> => {
    signal.throwIfAborted();
    const now = Math.floor(Date.now() / 1_000);
    const appToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(credentials.appId)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(createPrivateKey(credentials.privateKey));

    const repositoryPath = `/repos/${identity.owner}/${identity.repository}`;
    const installation = await request(
      `${repositoryPath}/installation`,
      appToken,
      signal,
    );
    const account = installation["account"] as { id?: unknown } | undefined;
    if (
      !Number.isSafeInteger(installation["id"]) ||
      String(account?.id) !== trustedOwnerId ||
      installation["suspended_at"] != null
    ) {
      throw new RequestError(403, "GitHub App installation is not authorized.");
    }

    const authentication = await request(
      `/app/installations/${installation["id"]}/access_tokens`,
      appToken,
      signal,
      {
        repository_ids: [identity.repositoryId],
        permissions: { administration: "read" },
      },
    );
    const installationToken = authentication["token"];
    if (typeof installationToken !== "string" || !installationToken) {
      throw new RequestError(503, "GitHub returned an invalid response.");
    }

    const runners: Runner[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await request(
        `${repositoryPath}/actions/runners?per_page=100&page=${page}`,
        installationToken,
        signal,
      );
      const batch = result["runners"];
      const total = result["total_count"];
      if (
        typeof total !== "number" ||
        !Number.isSafeInteger(total) ||
        total < 0 ||
        !Array.isArray(batch) ||
        !batch.every(isRunner)
      ) {
        throw new RequestError(503, "GitHub returned an invalid response.");
      }
      if (total > 1_000)
        throw new RequestError(503, "Runner list exceeds the supported limit.");
      runners.push(...batch);
      if (batch.length < 100 || runners.length === total) return runners;
    }
    throw new RequestError(503, "Runner list exceeds the supported limit.");
  };
}

function isRunner(value: unknown): value is Runner {
  if (!value || typeof value !== "object") return false;
  const runner = value as Record<string, unknown>;
  return (
    typeof runner["status"] === "string" &&
    Array.isArray(runner["labels"]) &&
    runner["labels"].every(
      (label: unknown) =>
        !!label &&
        typeof label === "object" &&
        typeof (label as { name?: unknown }).name === "string",
    )
  );
}
