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
const lookupSignal = new AbortController().signal;

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
      return Response.json({ total_count: 1, runners: [onlineRunner] });
    });
    expect(await list(identity, lookupSignal)).toEqual([onlineRunner]);
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
        total_count: 101,
        runners:
          page === "1"
            ? Array.from({ length: 100 }, () => ({
                ...onlineRunner,
                status: "offline",
              }))
            : [onlineRunner],
      });
    });
    const result = await list(identity, lookupSignal);
    expect(result).toHaveLength(101);
    expect(result[100]).toEqual(onlineRunner);
    expect(pages).toEqual(["1", "2"]);
  });

  test.each([999, 1000, 1001])(
    "enforces the 1000-runner limit for %i runners",
    async (total) => {
      const pages: number[] = [];
      const list = createGitHubRunnerClient(credentials, async (url) => {
        if (url.endsWith("/installation")) return Response.json(installation);
        if (url.endsWith("/access_tokens"))
          return Response.json({ token: installationToken });
        const page = Number(new URL(url).searchParams.get("page"));
        pages.push(page);
        return Response.json({
          total_count: total,
          runners: Array.from(
            { length: Math.min(100, total - (page - 1) * 100) },
            () => onlineRunner,
          ),
        });
      });
      if (total > 1000) {
        await expect(list(identity, lookupSignal)).rejects.toMatchObject({
          status: 503,
        });
      } else {
        expect(await list(identity, lookupSignal)).toHaveLength(total);
        expect(pages).toHaveLength(10);
      }
      expect(pages.length).toBeLessThanOrEqual(10);
    },
  );

  test("does not contact GitHub after the selection deadline expires", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture selection deadline");
    controller.abort(reason);
    let calls = 0;
    const list = createGitHubRunnerClient(credentials, async () => {
      calls++;
      return Response.json(installation);
    });
    await expect(list(identity, controller.signal)).rejects.toBe(reason);
    expect(calls).toBe(0);
  });

  test("shares cancellation across sequential GitHub requests", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture selection deadline");
    const paths: string[] = [];
    const signals: AbortSignal[] = [];
    const list = createGitHubRunnerClient(credentials, async (url, options) => {
      paths.push(new URL(url).pathname);
      signals.push(options.signal!);
      if (url.endsWith("/installation")) return Response.json(installation);
      controller.abort(reason);
      return Response.json({ token: installationToken });
    });
    await expect(list(identity, controller.signal)).rejects.toBe(reason);
    expect(paths).toEqual([
      "/repos/arklanq/raycast-x/installation",
      "/app/installations/123/access_tokens",
    ]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
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
      await expect(list(identity, lookupSignal)).rejects.toMatchObject({
        status: 403,
      });
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
      await expect(list(identity, lookupSignal)).rejects.toMatchObject({
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
        total_count: 1,
        runners: [{ status: "online", labels: [{ name: 123 }] }],
      });
    });
    await expect(list(identity, lookupSignal)).rejects.toMatchObject({
      status: 503,
    });
  });

  test.each([undefined, -1, 1.5, "1"])(
    "rejects an invalid runner count %j",
    async (total) => {
      const list = createGitHubRunnerClient(credentials, async (url) => {
        if (url.endsWith("/installation")) return Response.json(installation);
        if (url.endsWith("/access_tokens"))
          return Response.json({ token: installationToken });
        return Response.json({ total_count: total, runners: [onlineRunner] });
      });
      await expect(list(identity, lookupSignal)).rejects.toMatchObject({
        status: 503,
      });
    },
  );
});
