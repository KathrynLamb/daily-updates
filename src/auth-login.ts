// src/auth-login.ts
//
// Logs in as one demo account using the identity provider's device flow:
// this prints a link and a code, you sign in on the provider's own login
// page, and the resulting access token is saved in .tokens/.
//
// Run: npm run auth:login -- practitioner
//
// Needs AUTH_ISSUER, AUTH_AUDIENCE and AUTH_CLI_CLIENT_ID in .env.

import "dotenv/config";
import { z } from "zod";
import {
  demoAccountFromArguments,
  demoAccounts,
  saveToken,
  unverifiedClaims,
} from "./demo-accounts.js";

const environment = z
  .object({
    AUTH_ISSUER: z.url(),
    AUTH_AUDIENCE: z.string().trim().min(1),
    AUTH_CLI_CLIENT_ID: z.string().trim().min(1),
  })
  .safeParse(process.env);

if (!environment.success) {
  console.error(
    "Set AUTH_ISSUER, AUTH_AUDIENCE and AUTH_CLI_CLIENT_ID in .env first."
  );
  process.exit(1);
}

const { AUTH_ISSUER, AUTH_AUDIENCE, AUTH_CLI_CLIENT_ID } =
  environment.data;

const account = demoAccountFromArguments();

// Auth0 issuers end with a slash; build URLs that work either way.
const endpoint = (path: string) => new URL(path, AUTH_ISSUER).toString();

async function postForm(
  url: string,
  fields: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >,
  };
}

const deviceCodeResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().default(5),
});

const started = await postForm(endpoint("oauth/device/code"), {
  client_id: AUTH_CLI_CLIENT_ID,
  audience: AUTH_AUDIENCE,
  scope: "openid",
});

const device = deviceCodeResponse.safeParse(started.body);

if (started.status !== 200 || !device.success) {
  console.error(
    `Could not start login (${started.status}):`,
    started.body.error_description ?? started.body.error ?? started.body
  );
  console.error(
    "Check AUTH_CLI_CLIENT_ID, and that the application has the " +
      "Device Code grant enabled."
  );
  process.exit(1);
}

const {
  device_code,
  user_code,
  verification_uri,
  verification_uri_complete,
  expires_in,
} = device.data;

console.log(
  `\nLogging in as the demo ${account} ` +
    `(${demoAccounts[account].description}).` +
    "\n\nUse a private browser window, so you are not signed in as a " +
    "different demo account.\n" +
    `\n  Open:  ${verification_uri_complete ?? verification_uri}` +
    `\n  Code:  ${user_code}\n` +
    `\nThen sign in with the ${account} account's email and password.` +
    "\nWaiting..."
);

let interval = device.data.interval;
const deadline = Date.now() + expires_in * 1000;

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, interval * 1000));

  const polled = await postForm(endpoint("oauth/token"), {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code,
    client_id: AUTH_CLI_CLIENT_ID,
  });

  const error = polled.body.error;

  if (error === "authorization_pending") {
    continue;
  }

  if (error === "slow_down") {
    interval += 5;
    continue;
  }

  if (error) {
    console.error(
      `\nLogin failed: ${polled.body.error_description ?? error}`
    );
    process.exit(1);
  }

  const accessToken = polled.body.access_token;
  const expiresIn = polled.body.expires_in;

  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    console.error("\nLogin returned an unexpected response.");
    process.exit(1);
  }

  const claims = unverifiedClaims(accessToken);

  if (typeof claims.iss !== "string" || typeof claims.sub !== "string") {
    console.error("\nThe access token has no issuer or subject.");
    process.exit(1);
  }

  await saveToken(account, {
    accessToken,
    issuer: claims.iss,
    subject: claims.sub,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });

  console.log(
    `\nLogged in as ${claims.sub}.` +
      `\nToken saved to .tokens/${account}.json.` +
      `\nNext, if you have not already: npm run auth:link -- ${account}\n`
  );
  process.exit(0);
}

console.error("\nThe login code expired. Run the command again.");
process.exit(1);