import { spawn } from "node:child_process";
import { createPrivateKey, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const setupTimeout = 10 * 60 * 1000;
const defaultServiceUrl = "https://ci-workflows.vercel.app";

export type AppCredentials = { id: number; slug: string; pem: string };
type LinkedProject = { projectId: string; orgId: string };
type RunVercel = (arguments_: string[], input?: string) => Promise<void>;

export function createManifest(serviceUrl: string, callbackUrl: string) {
  const url = new URL(serviceUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("The service URL must be an HTTPS origin.");
  }
  return {
    name: "arklanq-ci-runner",
    url: url.origin,
    description:
      "Selects an online self-hosted runner for trusted GitHub Actions workflows.",
    redirect_url: callbackUrl,
    public: false,
    request_oauth_on_install: false,
    hook_attributes: { url: `${url.origin}/api/select-runner`, active: false },
    default_events: [],
    default_permissions: { administration: "read", metadata: "read" },
  };
}

export function createCallbackSession(now: () => number = Date.now) {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = now() + setupTimeout;
  let consumed = false;
  return {
    state,
    consume(url: URL) {
      const suppliedState = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (
        consumed ||
        now() >= expiresAt ||
        url.pathname !== "/callback" ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.getAll("code").length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(suppliedState) ||
        !timingSafeEqual(Buffer.from(suppliedState), Buffer.from(state)) ||
        !/^[A-Za-z0-9_-]{20,256}$/.test(code)
      ) {
        throw new Error("Invalid, expired, or already used setup callback.");
      }
      consumed = true;
      return code;
    },
  };
}

export async function exchangeManifestCode(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<AppCredentials> {
  let response: Response;
  try {
    response = await fetcher(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error("Could not exchange the GitHub App manifest code.");
  }
  if (!response.ok)
    throw new Error(
      `GitHub App registration failed (HTTP ${response.status}).`,
    );
  try {
    const text = await response.text();
    if (text.length > 64 * 1024) throw new Error();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") throw new Error();
    const { id, slug, pem } = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(id) ||
      Number(id) <= 0 ||
      typeof slug !== "string" ||
      !/^[a-z0-9-]+$/.test(slug) ||
      typeof pem !== "string"
    ) {
      throw new Error();
    }
    if (createPrivateKey(pem).asymmetricKeyType !== "rsa") throw new Error();
    return { id: Number(id), slug, pem };
  } catch {
    throw new Error("GitHub returned an invalid App configuration.");
  }
}

export async function configureVercelApp(
  credentials: AppCredentials,
  project: LinkedProject,
  run: RunVercel,
) {
  const destination = [
    "--project",
    project.projectId,
    "--scope",
    project.orgId,
  ];
  const variables: Array<[string, string, "config" | "secret"]> = [
    ["GITHUB_APP_ID", String(credentials.id), "config"],
    ["GITHUB_APP_PRIVATE_KEY", credentials.pem, "secret"],
  ];
  for (const [name, value, type] of variables) {
    await run(
      [
        "env",
        "add",
        name,
        "production",
        "--type",
        type,
        "--force",
        "--yes",
        ...destination,
      ],
      value,
    );
  }
  await run(["deploy", "--prod", "--yes", ...destination]);
}

export async function retainCredentials(
  root: string,
  credentials: AppCredentials,
) {
  const directory = resolve(root, ".local");
  const file = resolve(directory, "github-app.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(file, JSON.stringify(credentials), {
    flag: "wx",
    mode: 0o600,
  });
  return file;
}

function runVercel(root: string): RunVercel {
  return (arguments_, input) =>
    new Promise((resolveCommand, reject) => {
      const child = spawn("vercel", arguments_, {
        cwd: root,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: setupTimeout,
      });
      child.on("error", () =>
        reject(
          new Error(
            "Could not start Vercel CLI. Install it and run vercel login.",
          ),
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input);
      child.on("exit", (code) =>
        code === 0
          ? resolveCommand()
          : reject(
              new Error(
                "Vercel configuration or deployment failed. Check your Vercel login and linked project.",
              ),
            ),
      );
    });
}

function openBrowser(url: string) {
  const [command, arguments_]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, arguments_, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Open this URL in your browser: ${url}`));
  child.unref();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function runSetup(
  root: string,
  serviceUrl = defaultServiceUrl,
  resume = false,
) {
  createManifest(serviceUrl, "http://127.0.0.1/callback");
  let project: LinkedProject;
  try {
    project = JSON.parse(
      await readFile(resolve(root, ".vercel/project.json"), "utf8"),
    ) as LinkedProject;
    if (
      !/^prj_[A-Za-z0-9]+$/.test(project.projectId) ||
      !/^team_[A-Za-z0-9]+$/.test(project.orgId)
    )
      throw new Error();
  } catch {
    throw new Error(
      "Link this checkout to the ci-workflows Vercel project before running setup.",
    );
  }
  const run = runVercel(root);
  await run(["whoami"]);
  const recoveryFile = resolve(root, ".local/github-app.json");
  if (resume) {
    let credentials: AppCredentials;
    try {
      credentials = JSON.parse(
        await readFile(recoveryFile, "utf8"),
      ) as AppCredentials;
      if (
        !Number.isSafeInteger(credentials.id) ||
        credentials.id <= 0 ||
        !/^[a-z0-9-]+$/.test(credentials.slug) ||
        createPrivateKey(credentials.pem).asymmetricKeyType !== "rsa"
      )
        throw new Error();
    } catch {
      throw new Error(
        "Saved App credentials are missing or invalid. Check .local/github-app.json without sharing its contents.",
      );
    }
    await configureVercelApp(credentials, project, run);
    await unlink(recoveryFile);
    const installationUrl = `https://github.com/apps/${credentials.slug}/installations/new`;
    console.log(
      `Credentials configured. Approve the installation on arklanq: ${installationUrl}`,
    );
    openBrowser(installationUrl);
    return;
  }
  try {
    await readFile(recoveryFile);
    throw new Error(
      "A saved App registration exists. Run bun run setup:app -- --resume instead of creating another App.",
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  const session = createCallbackSession();
  await new Promise<void>((resolveSetup, reject) => {
    let origin = "";
    const server = createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (
        request.method !== "GET" ||
        request.headers.host !== new URL(origin).host
      ) {
        response.writeHead(403).end("Forbidden.");
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname === "/") {
        const manifest = createManifest(serviceUrl, `${origin}/callback`);
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>Register runner selection App</title><p>Continue to GitHub to create the private runner selection App.</p><form action="https://github.com/settings/apps/new?state=${session.state}" method="post"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"><button>Continue to GitHub</button></form><script>document.querySelector('form').submit();</script></html>`,
        );
        return;
      }
      if (url.pathname !== "/callback") {
        response.writeHead(404).end("Not found.");
        return;
      }
      let code: string;
      try {
        code = session.consume(url);
      } catch {
        response
          .writeHead(400)
          .end(
            "Invalid or already used setup callback. Return to the terminal.",
          );
        return;
      }
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(
        "GitHub App registered. The terminal is configuring the service. An installation page will open when ready.",
      );
      clearTimeout(timer);
      server.close();
      try {
        const credentials = await exchangeManifestCode(code);
        await retainCredentials(root, credentials);
        await configureVercelApp(credentials, project, run);
        await unlink(recoveryFile);
        const installationUrl = `https://github.com/apps/${credentials.slug}/installations/new`;
        console.log(
          `Credentials configured. Approve the installation on arklanq: ${installationUrl}`,
        );
        openBrowser(installationUrl);
        resolveSetup();
      } catch (error) {
        console.error(
          "If registration credentials were saved, resume with: bun run setup:app -- --resume",
        );
        reject(error);
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          "Setup expired after ten minutes. Run it again when you are ready to approve the App.",
        ),
      );
    }, setupTimeout);
    server.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not start the loopback setup server."));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return;
      origin = `http://127.0.0.1:${address.port}`;
      console.log(
        `Approve creation of the App while logged in as arklanq: ${origin}`,
      );
      openBrowser(origin);
    });
  });
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
  const serviceUrlIndex = arguments_.indexOf("--service-url");
  const serviceUrl =
    serviceUrlIndex === -1
      ? defaultServiceUrl
      : arguments_[serviceUrlIndex + 1];
  const allowed = arguments_.filter(
    (_, index) =>
      serviceUrlIndex === -1 ||
      (index !== serviceUrlIndex && index !== serviceUrlIndex + 1),
  );
  if (!serviceUrl || allowed.some((value) => value !== "--resume")) {
    console.error(
      "Usage: bun run setup:app [--service-url https://service.example] [--resume]",
    );
    process.exitCode = 1;
  } else {
    runSetup(process.cwd(), serviceUrl, arguments_.includes("--resume")).catch(
      (error: unknown) => {
        console.error(
          error instanceof Error ? error.message : "GitHub App setup failed.",
        );
        process.exitCode = 1;
      },
    );
  }
}
