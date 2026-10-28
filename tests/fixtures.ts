import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  SignJWT,
} from "jose";
import {
  createIdentityVerifier,
  oidcAudience,
  oidcIssuer,
  trustedOwnerId,
  trustedWorkflow,
} from "../src/identity.js";

export const keys = await generateKeyPair("RS256", { extractable: true });
export const publicJwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: "fixture",
  alg: "RS256",
};
export const verifyIdentity = createIdentityVerifier(
  createLocalJWKSet({ keys: [publicJwk] }),
);
export const privateKeyPem = await exportPKCS8(keys.privateKey);
export const identity = {
  owner: "arklanq",
  repository: "raycast-x",
  repositoryId: 1435642158,
};
export const primary = ["self-hosted", "ubuntu-26.04-self-hosted"];
export const selection = {
  primaryRunner: primary.join(","),
  fallbackRunner: "ubuntu-26.04",
};
export const onlineRunner = {
  status: "online",
  busy: true,
  labels: primary.map((name) => ({ name })),
};

export async function signIdentity(
  overrides: Record<string, unknown> = {},
  signingKey = keys.privateKey,
) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    iss: oidcIssuer,
    aud: oidcAudience,
    sub: "repo:arklanq@23725071/raycast-x@1435642158:ref:refs/heads/main",
    iat: now,
    nbf: now - 5,
    exp: now + 300,
    repository: "arklanq/raycast-x",
    repository_id: String(identity.repositoryId),
    repository_owner: "arklanq",
    repository_owner_id: trustedOwnerId,
    job_workflow_ref: trustedWorkflow,
    runner_environment: "github-hosted",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .sign(signingKey);
}
