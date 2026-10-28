import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const oidcIssuer = "https://token.actions.githubusercontent.com";
export const oidcAudience = "https://github.com/arklanq/ci-workflows";
export const trustedOwnerId = "23725071";
export const trustedWorkflow =
  "arklanq/ci-workflows/.github/workflows/select-runner.yaml@refs/heads/main";

const githubKeys = createRemoteJWKSet(
  new URL(`${oidcIssuer}/.well-known/jwks`),
  { timeoutDuration: 5_000 },
);

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface WorkflowIdentity {
  owner: string;
  repository: string;
  repositoryId: number;
}

export function createIdentityVerifier(keys: JWTVerifyGetKey = githubKeys) {
  return async (token: string): Promise<WorkflowIdentity> => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: oidcIssuer,
        audience: oidcAudience,
        algorithms: ["RS256"],
        requiredClaims: [
          "exp",
          "nbf",
          "sub",
          "repository",
          "repository_id",
          "repository_owner_id",
          "job_workflow_ref",
        ],
        maxTokenAge: "10 minutes",
        clockTolerance: 5,
      }));
    } catch {
      throw new RequestError(401, "Invalid workflow identity.");
    }

    if (
      payload.repository_owner_id !== trustedOwnerId ||
      payload.repository_owner !== "arklanq" ||
      payload.job_workflow_ref !== trustedWorkflow ||
      payload.runner_environment !== "github-hosted"
    ) {
      throw new RequestError(403, "Workflow is not authorized.");
    }

    const repository =
      typeof payload.repository === "string"
        ? /^arklanq\/([A-Za-z0-9_.-]+)$/.exec(payload.repository)?.[1]
        : undefined;
    const repositoryId =
      typeof payload.repository_id === "string" &&
      /^[1-9]\d*$/.test(payload.repository_id)
        ? Number(payload.repository_id)
        : NaN;
    if (!repository || !Number.isSafeInteger(repositoryId)) {
      throw new RequestError(403, "Repository identity is invalid.");
    }

    return { owner: "arklanq", repository, repositoryId };
  };
}
