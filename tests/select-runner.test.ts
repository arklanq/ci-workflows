import { describe, expect, spyOn, test } from "bun:test";
import { createGitHubRunnerClient, type Runner } from "../src/github.js";
import type { WorkflowIdentity } from "../src/identity.js";
import { createSelectRunnerHandler } from "../src/select-runner.js";
import {
  identity,
  onlineRunner,
  primary,
  privateKeyPem,
  selection,
  signIdentity,
  verifyIdentity,
} from "./fixtures.js";

async function request(body: unknown = selection, token?: string) {
  return new Request("https://service.example/api/select-runner", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token ?? (await signIdentity())}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function handler(runners: Runner[] = [onlineRunner]) {
  return createSelectRunnerHandler({
    verifyIdentity,
    listRunners: async () => runners,
    reportError: () => {},
  });
}

describe("runner service", () => {
  test("prefers an online runner while it is busy", async () => {
    const response = await handler()(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runner: primary });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("starts the shared deadline before identity verification", async () => {
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      deadline.signal,
    );
    let lookups = 0;
    const select = createSelectRunnerHandler({
      verifyIdentity: async () => {
        deadline.abort(new Error("private timeout details"));
        return identity;
      },
      listRunners: async () => {
        lookups++;
        return [onlineRunner];
      },
      reportError: () => {},
    });
    try {
      const response = await select(await request());
      expect(timeout).toHaveBeenCalledWith(8_000);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Runner selection is unavailable.",
      });
      expect(lookups).toBe(0);
    } finally {
      timeout.mockRestore();
    }
  });

  test("cancels an unfinished request body when the deadline expires", async () => {
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      deadline.signal,
    );
    const reading = Promise.withResolvers<void>();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading.resolve();
          return new Promise(() => {});
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const select = createSelectRunnerHandler({
      verifyIdentity: async () => identity,
      listRunners: async () => [onlineRunner],
      reportError: () => {},
    });
    try {
      const response = select(
        new Request("https://service.example/api/select-runner", {
          method: "POST",
          headers: {
            Authorization: "Bearer fixture",
            "Content-Type": "application/json",
          },
          body,
        }),
      );
      await reading.promise;
      deadline.abort(new Error("private timeout details"));
      expect((await response).status).toBe(503);
      expect(cancelled).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  test("cancels in-flight GitHub access using the handler's shared deadline", async () => {
    const deadline = new AbortController();
    const nativeTimeout = AbortSignal.timeout;
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
      (duration) =>
        duration === 8_000 ? deadline.signal : nativeTimeout(duration),
    );
    let calls = 0;
    const listRunners = createGitHubRunnerClient(
      { appId: "1234", privateKey: privateKeyPem },
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          calls++;
          options.signal!.addEventListener(
            "abort",
            () => reject(options.signal!.reason),
            { once: true },
          );
          deadline.abort(new Error("private timeout details"));
        }),
    );
    const select = createSelectRunnerHandler({
      verifyIdentity: async () => identity,
      listRunners,
      reportError: () => {},
    });
    try {
      const response = await select(await request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Runner selection is unavailable.",
      });
      expect(calls).toBe(1);
    } finally {
      timeout.mockRestore();
    }
  });

  test.each([
    ["offline", [{ ...onlineRunner, status: "offline" }]],
    [
      "missing labels",
      [{ ...onlineRunner, labels: [{ name: "self-hosted" }] }],
    ],
    [
      "different case",
      [
        {
          ...onlineRunner,
          labels: [
            { name: "self-hosted" },
            { name: "Ubuntu-26.04-self-hosted" },
          ],
        },
      ],
    ],
    ["no runners", []],
  ])("returns the hosted fallback for %s", async (_name, runners) => {
    const response = await handler(runners)(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runner: [selection.fallbackRunner],
    });
  });

  test("takes the repository from the signed identity instead of the request body", async () => {
    let lookedUp: WorkflowIdentity | undefined;
    const select = createSelectRunnerHandler({
      verifyIdentity,
      listRunners: async (value) => {
        lookedUp = value;
        return [onlineRunner];
      },
    });
    await select(
      await request({
        ...selection,
        repository: "attacker/other",
        repositoryId: 999,
      }),
    );
    expect(lookedUp).toEqual(identity);
  });

  test("rejects unauthorized callers without contacting GitHub", async () => {
    let calls = 0;
    const select = createSelectRunnerHandler({
      verifyIdentity,
      listRunners: async () => {
        calls++;
        return [];
      },
    });
    for (const token of [
      "invalid",
      await signIdentity({ repository_owner_id: "999" }),
    ]) {
      const response = await select(await request(selection, token));
      expect([401, 403]).toContain(response.status);
    }
    expect(calls).toBe(0);
  });

  test.each([
    [null],
    [[]],
    [{}],
    { ...selection, primaryRunner: "self-hosted, label-with-space" },
    { ...selection, primaryRunner: "ubuntu-26.04-self-hosted" },
    { ...selection, primaryRunner: "self-hosted," },
    { ...selection, primaryRunner: "self-hosted," + "x,".repeat(10) },
    { ...selection, fallbackRunner: "self-hosted" },
    { ...selection, fallbackRunner: "ubuntu-latest\nmalicious" },
  ])("rejects malformed selection %j", async (body) => {
    const response = await handler()(await request(body));
    expect(response.status).toBe(400);
  });

  test("bounds the body even when Content-Length is absent", async () => {
    const response = await handler()(
      await request({ ...selection, padding: "x".repeat(2_048) }),
    );
    expect(response.status).toBe(413);
  });

  test("handles malformed JSON and unsupported content types", async () => {
    const token = await signIdentity();
    for (const [body, contentType, status] of [
      ["{", "application/json", 400],
      ["{}", "text/plain", 415],
    ] as const) {
      const response = await handler()(
        new Request("https://service.example/api/select-runner", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
          },
          body,
        }),
      );
      expect(response.status).toBe(status);
    }
  });

  test("rejects unauthenticated requests and unsupported methods", async () => {
    expect(
      (
        await handler()(
          new Request("https://service.example/api/select-runner", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    const response = await handler()(
      new Request("https://service.example/api/select-runner"),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("does not return or log raw upstream errors or tokens", async () => {
    const reports: number[] = [];
    const select = createSelectRunnerHandler({
      verifyIdentity,
      listRunners: async () => {
        throw new Error("private-installation-token and private-key");
      },
      reportError: (status) => reports.push(status),
    });
    const response = await select(await request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      '{"error":"Runner selection is unavailable."}',
    );
    expect(reports).toEqual([503]);
  });
});
