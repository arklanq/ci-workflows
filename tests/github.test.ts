import { describe, expect, test } from "bun:test";
import { jwtVerify } from "jose";
import { createGitHubRunnerClient } from "../src/github.js";
import { trustedOwnerId } from "../src/identity.js";
import { identity, keys, onlineRunner, privateKeyPem } from "./fixtures.js";

const credentials = { appId: "1234", privateKey: privateKeyPem };
const installation = {
  id: 123,
  account: { id: Number(trustedOwnerId) },
  suspended_at: null,
};
const installationToken = "installation-token-fixture";

describe("GitHub App runner lookup", () => {
  test("signs an App JWT, scopes its token to the signed repository ID, and reads runners", async () => {
    const paths: string[] = [];
    const list = createGitHubRunnerClient(credentials, async (url, options) => {
      paths.push(new URL(url).pathname);
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      const authorization = new Headers(options.headers).get("authorization")!;
      if (!url.includes("actions/runners")) {
        const { payload } = await jwtVerify(
          authorization.slice(7),
          keys.publicKey,
          { algorithms: ["RS256"], issuer: credentials.appId },
        );
        expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
      }
      if (url.endsWith("/installation")) return Response.json(installation);
      if (url.endsWith("/access_tokens")) {
        expect(options.method).toBe("POST");
        expect(JSON.parse(String(options.body))).toEqual({
          repository_ids: [identity.repositoryId],
          permissions: { administration: "read" },
        });
        return Response.json({ token: installationToken });
      }
      expect(authorization).toBe(`Bearer ${installationToken}`);
      expect(new URL(url).searchParams.get("per_page")).toBe("100");
      return Response.json({ runners: [onlineRunner] });
    });
    expect(await list(identity)).toEqual([onlineRunner]);
    expect(paths).toEqual([
      "/repos/arklanq/raycast-x/installation",
      "/app/installations/123/access_tokens",
      "/repos/arklanq/raycast-x/actions/runners",
    ]);
  });

  test("reads additional pages instead of missing a preferred runner on page two", async () => {
    const pages: string[] = [];
    const list = createGitHubRunnerClient(credentials, async (url) => {
      if (url.endsWith("/installation")) return Response.json(installation);
      if (url.endsWith("/access_tokens"))
        return Response.json({ token: installationToken });
      const page = new URL(url).searchParams.get("page")!;
      pages.push(page);
      return Response.json({
        runners:
          page === "1"
            ? Array.from({ length: 100 }, () => ({
                ...onlineRunner,
                status: "offline",
              }))
            : [onlineRunner],
      });
    });
    const result = await list(identity);
    expect(result).toHaveLength(101);
    expect(result[100]).toEqual(onlineRunner);
    expect(pages).toEqual(["1", "2"]);
  });

  test.each([
    ["wrong owner", { ...installation, account: { id: 999 } }],
    [
      "suspended installation",
      { ...installation, suspended_at: "2026-10-28T00:00:00Z" },
    ],
    ["invalid installation ID", { ...installation, id: "123" }],
  ])(
    "rejects %s before requesting an installation token",
    async (_name, value) => {
      let calls = 0;
      const list = createGitHubRunnerClient(credentials, async () => {
        calls++;
        return Response.json(value);
      });
      await expect(list(identity)).rejects.toMatchObject({ status: 403 });
      expect(calls).toBe(1);
    },
  );

  test.each([401, 403, 404, 429, 500])(
    "handles upstream HTTP %s without exposing response details",
    async (status) => {
      const list = createGitHubRunnerClient(credentials, async () =>
        Response.json(
          { token: installationToken, message: "private response" },
          { status },
        ),
      );
      await expect(list(identity)).rejects.toMatchObject({
        status: 503,
        message: "GitHub runner lookup is unavailable.",
      });
    },
  );

  test("rejects malformed runner responses", async () => {
    const list = createGitHubRunnerClient(credentials, async (url) => {
      if (url.endsWith("/installation")) return Response.json(installation);
      if (url.endsWith("/access_tokens"))
        return Response.json({ token: installationToken });
      return Response.json({
        runners: [{ status: "online", labels: [{ name: 123 }] }],
      });
    });
    await expect(list(identity)).rejects.toMatchObject({ status: 503 });
  });
});
