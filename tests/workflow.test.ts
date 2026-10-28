import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflow = Bun.YAML.parse(
  readFileSync(
    new URL("../.github/workflows/select-runner.yaml", import.meta.url),
    "utf8",
  ),
) as {
  permissions: { "id-token": string };
  jobs: {
    "select-runner": {
      steps: { with: { script: string }; env: Record<string, string> }[];
    };
  };
};
const step = workflow.jobs["select-runner"].steps[0]!;
const runScript = new Function(
  "core",
  "process",
  "fetch",
  "AbortSignal",
  `return (async () => { ${step.with.script} })()`,
);
const primaryRunner = "self-hosted,ubuntu-26.04-self-hosted";
const fallbackRunner = "ubuntu-26.04";

async function run(
  response: unknown,
  options: {
    oidcStatus?: number;
    oidcMessage?: string;
    serviceStatus?: number;
    missingPermission?: boolean;
    networkError?: boolean;
  } = {},
) {
  const outputs: string[] = [];
  const masks: string[] = [];
  const warnings: string[] = [];
  const audiences: string[] = [];
  const calls: { url: string; options: RequestInit }[] = [];
  const env: Record<string, string> = {
    PRIMARY_RUNNER: primaryRunner,
    FALLBACK_RUNNER: fallbackRunner,
    RUNNER_SERVICE_URL: step.env["RUNNER_SERVICE_URL"]!,
  };
  await runScript(
    {
      getIDToken: async (audience: string) => {
        audiences.push(audience);
        if (options.oidcMessage) throw new Error(options.oidcMessage);
        if (options.missingPermission || options.oidcStatus)
          throw new Error("private OIDC token-fixture failure");
        return "oidc-token-fixture";
      },
      setOutput: (_name: string, value: string) => outputs.push(value),
      setSecret: (value: string) => masks.push(value),
      warning: (value: string) => warnings.push(value),
    },
    { env },
    async (url: URL | string, requestOptions: RequestInit) => {
      calls.push({ url: String(url), options: requestOptions });
      expect(requestOptions.redirect).toBe("error");
      expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
      if (options.networkError) throw new Error("private upstream details");
      return Response.json(response, { status: options.serviceStatus ?? 200 });
    },
    AbortSignal,
  );
  return {
    selected: JSON.parse(outputs.at(-1)!),
    outputs,
    masks,
    warnings,
    calls,
    audiences,
  };
}

describe("reusable workflow", () => {
  test("explicitly requests OIDC permission in the called workflow", () => {
    expect(workflow.permissions["id-token"]).toBe("write");
  });

  test("sends the masked OIDC identity to the fixed service and accepts matching primary labels", async () => {
    const result = await run({ runner: primaryRunner.split(",") });
    expect(result.selected).toEqual(primaryRunner.split(","));
    expect(result.masks).toEqual(["oidc-token-fixture"]);
    expect(result.warnings).toEqual([]);
    expect(result.audiences).toEqual(["https://ci-workflows.vercel.app"]);
    expect(result.calls[0]!.url).toBe(
      "https://ci-workflows.vercel.app/api/select-runner",
    );
    expect(result.calls[0]!.options.headers).toEqual({
      authorization: "Bearer oidc-token-fixture",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(result.calls[0]!.options.body))).toEqual({
      primaryRunner,
      fallbackRunner,
    });
  });

  test("accepts the configured hosted fallback", async () => {
    expect((await run({ runner: [fallbackRunner] })).selected).toEqual([
      fallbackRunner,
    ]);
  });

  test("reports a bounded issuer explanation without credential-like values or URLs", async () => {
    const secret = "longcredentialfixture".repeat(8);
    const result = await run(
      {},
      {
        oidcMessage: `Error Code : 400\nError Message: Invalid audience ${secret} https://issuer.example/private-url`,
      },
    );
    expect(result.warnings[0]).toContain("HTTP 400: Invalid audience");
    expect(result.warnings[0]).not.toContain(secret);
    expect(result.warnings[0]).not.toContain("https://");
    expect(result.selected).toEqual([fallbackRunner]);
  });

  test.each([
    [{ runner: ["self-hosted", "other-machine"] }],
    [{ runner: "self-hosted" }],
    [{ runner: [] }],
    [{}],
  ])("rejects unrequested runner labels in %j", async (response) => {
    const result = await run(response);
    expect(result.selected).toEqual([fallbackRunner]);
    expect(result.warnings).toHaveLength(1);
  });

  test.each([
    { oidcStatus: 403 },
    { serviceStatus: 503 },
    { networkError: true },
    { missingPermission: true },
  ])(
    "keeps the fallback when authentication or service access fails: %j",
    async (options) => {
      const result = await run({ runner: primaryRunner.split(",") }, options);
      expect(result.selected).toEqual([fallbackRunner]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        options.oidcStatus || options.missingPermission
          ? "OIDC authentication"
          : "runner service",
      );
      if (options.serviceStatus)
        expect(result.warnings[0]).toContain("HTTP 503");
      expect(result.warnings.join(" ")).not.toContain("token-fixture");
      expect(result.warnings.join(" ")).not.toContain(
        "private upstream details",
      );
    },
  );
});
