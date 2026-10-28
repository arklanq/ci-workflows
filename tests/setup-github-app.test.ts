import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureVercelApp,
  createCallbackSession,
  createManifest,
  exchangeManifestCode,
  retainCredentials,
} from "../scripts/setup-github-app.js";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
const credentials = { id: 123, slug: "arklanq-ci-runner", pem };
const project = { projectId: "prj_fixture", orgId: "team_fixture" };
const directories: string[] = [];

afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

describe("App registration manifest", () => {
  test("requests only repository read permissions without webhooks or OAuth", () => {
    const manifest = createManifest(
      "https://runner.example",
      "http://127.0.0.1:1234/callback",
    );
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({
      administration: "read",
      metadata: "read",
    });
    expect(manifest.default_events).toEqual([]);
    expect(manifest.request_oauth_on_install).toBe(false);
    expect(manifest.hook_attributes).toEqual({
      url: "https://runner.example/api/select-runner",
      active: false,
    });
    expect(manifest.redirect_url).toBe("http://127.0.0.1:1234/callback");
  });

  test("rejects credentials, insecure origins, and service paths", () => {
    for (const url of [
      "http://runner.example",
      "https://user:secret@runner.example",
      "https://runner.example/path",
      "https://runner.example?token=secret",
    ]) {
      expect(() => createManifest(url, "http://127.0.0.1/callback")).toThrow();
    }
  });
});

describe("one-time callback", () => {
  test("accepts a matching state exactly once", () => {
    const session = createCallbackSession();
    const url = new URL(
      `http://127.0.0.1/callback?state=${session.state}&code=${"a".repeat(40)}`,
    );
    expect(session.consume(url)).toBe("a".repeat(40));
    expect(() => session.consume(url)).toThrow("already used");
  });

  test("rejects wrong state without consuming the valid callback", () => {
    const session = createCallbackSession();
    expect(() =>
      session.consume(
        new URL(`http://127.0.0.1/callback?state=wrong&code=${"a".repeat(40)}`),
      ),
    ).toThrow();
    expect(
      session.consume(
        new URL(
          `http://127.0.0.1/callback?state=${session.state}&code=${"a".repeat(40)}`,
        ),
      ),
    ).toBe("a".repeat(40));
  });

  test("rejects expired, malformed, and ambiguous callbacks", () => {
    let now = 100;
    const session = createCallbackSession(() => now);
    const valid = `http://127.0.0.1/callback?state=${session.state}&code=${"a".repeat(40)}`;
    for (const url of [
      valid.replace("/callback", "/other"),
      `${valid}&state=${session.state}`,
      `${valid}&code=other`,
      valid.replace("a".repeat(40), "short"),
    ]) {
      expect(() => session.consume(new URL(url))).toThrow();
    }
    now += 10 * 60 * 1000;
    expect(() => session.consume(new URL(valid))).toThrow("expired");
  });
});

describe("manifest exchange", () => {
  test("exchanges the code only with GitHub and keeps only required credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return Response.json(
        {
          ...credentials,
          client_secret: "unused-secret",
          webhook_secret: "unused-secret",
        },
        { status: 201 },
      );
    }) as typeof fetch;
    expect(await exchangeManifestCode("a".repeat(40), fetcher)).toEqual(
      credentials,
    );
    expect(calls[0]?.url).toBe(
      `https://api.github.com/app-manifests/${"a".repeat(40)}/conversions`,
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("never propagates response secrets or network errors", async () => {
    const secret = "fixture-private-value";
    const failing = (async () =>
      new Response(secret, { status: 422 })) as unknown as typeof fetch;
    await expect(exchangeManifestCode("a".repeat(40), failing)).rejects.toThrow(
      "HTTP 422",
    );
    const malformed = (async () =>
      Response.json({
        ...credentials,
        pem: secret,
      })) as unknown as typeof fetch;
    await expect(
      exchangeManifestCode("a".repeat(40), malformed),
    ).rejects.toThrow("invalid App configuration");
    const network = (async () => {
      throw new Error(secret);
    }) as unknown as typeof fetch;
    await expect(exchangeManifestCode("a".repeat(40), network)).rejects.toThrow(
      "Could not exchange",
    );
  });
});

describe("credential configuration", () => {
  test("sends the private key only on stdin and marks it as a production secret", async () => {
    const calls: Array<{ arguments_: string[]; input: string | undefined }> =
      [];
    await configureVercelApp(
      credentials,
      project,
      async (arguments_, input) => {
        calls.push({ arguments_, input });
      },
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]?.input).toBe("123");
    expect(calls[1]?.input).toBe(pem);
    expect(calls[1]?.arguments_).toEqual([
      "env",
      "add",
      "GITHUB_APP_PRIVATE_KEY",
      "production",
      "--type",
      "secret",
      "--force",
      "--yes",
      "--project",
      "prj_fixture",
      "--scope",
      "team_fixture",
    ]);
    expect(
      calls.every((call) => !call.arguments_.join(" ").includes(pem)),
    ).toBe(true);
    expect(calls[2]?.arguments_[0]).toBe("deploy");
    expect(calls[2]?.arguments_).toContain("--prod");
  });

  test("does not deploy after an environment upload failure", async () => {
    const calls: string[][] = [];
    await expect(
      configureVercelApp(credentials, project, async (arguments_) => {
        calls.push(arguments_);
        if (arguments_[2] === "GITHUB_APP_PRIVATE_KEY")
          throw new Error("fixture upload failure");
      }),
    ).rejects.toThrow("fixture upload failure");
    expect(calls.some((arguments_) => arguments_[0] === "deploy")).toBe(false);
  });

  test("keeps recovery credentials private and refuses to overwrite them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-app-setup-"));
    directories.push(directory);
    const file = await retainCredentials(directory, credentials);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(credentials);
    expect((await stat(join(directory, ".local"))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(retainCredentials(directory, credentials)).rejects.toThrow();
  });
});
