import { describe, expect, test } from "bun:test";
import { createSelectRunnerHandler } from "../src/select-runner.js";
import type { Runner } from "../src/github.js";
import type { WorkflowIdentity } from "../src/identity.js";
import {
  identity,
  onlineRunner,
  primary,
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
