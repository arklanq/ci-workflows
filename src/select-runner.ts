import {
  createGitHubRunnerClient,
  readAppCredentials,
  type Runner,
} from "./github.js";
import {
  createIdentityVerifier,
  RequestError,
  type WorkflowIdentity,
} from "./identity.js";

interface Dependencies {
  verifyIdentity: (token: string) => Promise<WorkflowIdentity>;
  listRunners: (identity: WorkflowIdentity) => Promise<Runner[]>;
  reportError: (status: number) => void;
}

const labelPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function createSelectRunnerHandler(
  overrides: Partial<Dependencies> = {},
) {
  const dependencies: Dependencies = {
    verifyIdentity: createIdentityVerifier(),
    listRunners: (identity) =>
      createGitHubRunnerClient(readAppCredentials())(identity),
    reportError: (status) =>
      console.error("Runner selection failed.", { status }),
    ...overrides,
  };

  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed." },
          { status: 405, headers: { ...responseHeaders, Allow: "POST" } },
        );
      }
      const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token || token.length > 16_384)
        throw new RequestError(401, "Workflow identity is required.");
      const identity = await dependencies.verifyIdentity(token);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim() !==
        "application/json"
      ) {
        throw new RequestError(415, "Content-Type must be application/json.");
      }

      const body = await readBody(request);
      const { primaryRunner, fallbackRunner } = parseSelection(body);
      const runners = await dependencies.listRunners(identity);
      const online = runners.some(
        (runner) =>
          runner.status === "online" &&
          primaryRunner.every((label) =>
            runner.labels.some((entry) => entry.name === label),
          ),
      );
      return Response.json(
        { runner: online ? primaryRunner : [fallbackRunner] },
        { headers: responseHeaders },
      );
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 503;
      if (status >= 500) dependencies.reportError(status);
      return Response.json(
        {
          error:
            error instanceof RequestError
              ? error.message
              : "Runner selection is unavailable.",
        },
        { status, headers: responseHeaders },
      );
    }
  };
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2_048) {
      await reader.cancel();
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "A valid JSON body is required.");
  }
}

function parseSelection(value: unknown): {
  primaryRunner: string[];
  fallbackRunner: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError(400, "Runner labels are invalid.");
  const body = value as Record<string, unknown>;
  const primaryRunner =
    typeof body["primaryRunner"] === "string"
      ? body["primaryRunner"].split(",")
      : [];
  const fallbackRunner = body["fallbackRunner"];
  if (
    primaryRunner.length === 0 ||
    primaryRunner.length > 10 ||
    !primaryRunner.includes("self-hosted") ||
    !primaryRunner.every((label) => labelPattern.test(label)) ||
    typeof fallbackRunner !== "string" ||
    !labelPattern.test(fallbackRunner) ||
    fallbackRunner === "self-hosted"
  ) {
    throw new RequestError(400, "Runner labels are invalid.");
  }
  return { primaryRunner, fallbackRunner };
}
