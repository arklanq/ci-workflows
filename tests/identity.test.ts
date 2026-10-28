import { describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import { identity, signIdentity, verifyIdentity } from "./fixtures.js";

describe("GitHub Actions identity", () => {
  test("accepts a correctly signed identity from the trusted hosted reusable workflow", async () => {
    expect(await verifyIdentity(await signIdentity())).toEqual(identity);
  });

  test.each([
    ["issuer", { iss: "https://attacker.example" }, 401],
    ["audience", { aud: "other-service" }, 401],
    ["expired token", { exp: 1 }, 401],
    ["future token", { nbf: Math.floor(Date.now() / 1_000) + 60 }, 401],
    ["stale token", { iat: Math.floor(Date.now() / 1_000) - 900 }, 401],
    ["owner ID", { repository_owner_id: "123" }, 403],
    ["owner name", { repository_owner: "other" }, 403],
    [
      "reusable workflow",
      {
        job_workflow_ref:
          "arklanq/other/.github/workflows/ci.yaml@refs/heads/main",
      },
      403,
    ],
    [
      "untrusted branch",
      {
        job_workflow_ref:
          "arklanq/ci-workflows/.github/workflows/select-runner.yaml@refs/heads/feature",
      },
      403,
    ],
    ["self-hosted identity", { runner_environment: "self-hosted" }, 403],
    ["repository path", { repository: "attacker/raycast-x" }, 403],
    ["path traversal", { repository: "arklanq/raycast-x/../../other" }, 403],
    ["repository ID", { repository_id: "1e3" }, 403],
    ["unsafe repository ID", { repository_id: "9007199254740993" }, 403],
  ])("rejects an invalid %s", async (_name, overrides, status) => {
    await expect(
      verifyIdentity(await signIdentity(overrides)),
    ).rejects.toMatchObject({ status });
  });

  test("rejects tokens signed with a different key", async () => {
    const otherKeys = await generateKeyPair("RS256");
    await expect(
      verifyIdentity(await signIdentity({}, otherKeys.privateKey)),
    ).rejects.toMatchObject({ status: 401 });
  });

  test("requires expiry and the reusable workflow claim", async () => {
    for (const overrides of [
      { exp: undefined },
      { job_workflow_ref: undefined },
    ]) {
      await expect(
        verifyIdentity(await signIdentity(overrides)),
      ).rejects.toMatchObject({ status: 401 });
    }
  });

  test("does not depend on one particular subject format", async () => {
    expect(
      await verifyIdentity(
        await signIdentity({ sub: "repo:arklanq/raycast-x:pull_request" }),
      ),
    ).toEqual(identity);
  });
});
