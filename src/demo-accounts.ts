// src/demo-accounts.ts
//
// The demo accounts used to try the app with real login, what each one
// is allowed to do, and where their login tokens are saved locally.
//
// Tokens are saved in .tokens/, which git ignores. They are short-lived
// and only for trying the app from this computer.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const demoAccounts = {
  practitioner: {
    description: "records observations, drafts, reviews and evaluates",
    access: { setting: "demo-setting", role: "practitioner" },
  },
  approver: {
    description: "can also approve and publish",
    access: { setting: "demo-setting", role: "approver" },
  },
  parent: {
    description: "reads Ava's published updates only",
    access: { child: "demo-ava" },
  },
  outsider: {
    description: "an approver at a different setting",
    access: { setting: "other-setting", role: "approver" },
  },
} as const;

export type DemoAccount = keyof typeof demoAccounts;

export function isDemoAccount(value: unknown): value is DemoAccount {
  return (
    typeof value === "string" &&
    Object.hasOwn(demoAccounts, value)
  );
}

export function demoAccountFromArguments(): DemoAccount {
  const name = process.argv[2];

  if (!isDemoAccount(name)) {
    console.error(
      `Name a demo account: ${Object.keys(demoAccounts).join(", ")}`
    );
    process.exit(1);
  }

  return name;
}

export type SavedToken = {
  accessToken: string;
  issuer: string;
  subject: string;
  expiresAt: string;
};

const tokenDirectory = ".tokens";

function tokenPath(account: DemoAccount) {
  return join(tokenDirectory, `${account}.json`);
}

export async function saveToken(
  account: DemoAccount,
  token: SavedToken
) {
  await mkdir(tokenDirectory, { recursive: true, mode: 0o700 });

  await writeFile(
    tokenPath(account),
    JSON.stringify(token, null, 2),
    { mode: 0o600 }
  );
}

// Returns null if the account has not logged in or its token expired.
export async function loadToken(
  account: DemoAccount
): Promise<SavedToken | null> {
  let saved: SavedToken;

  try {
    saved = JSON.parse(await readFile(tokenPath(account), "utf8"));
  } catch {
    return null;
  }

  if (Date.parse(saved.expiresAt) <= Date.now() + 60_000) {
    return null;
  }

  return saved;
}

// Finds another demo account already saved with this identity, even if
// its token has since expired. Two demo accounts must never be the same
// person, or the role checks would test the wrong thing.
export async function accountWithIdentity(
  issuer: string,
  subject: string,
  except: DemoAccount
): Promise<DemoAccount | null> {
  for (const account of Object.keys(demoAccounts) as DemoAccount[]) {
    if (account === except) {
      continue;
    }

    try {
      const saved: SavedToken = JSON.parse(
        await readFile(tokenPath(account), "utf8")
      );

      if (saved.issuer === issuer && saved.subject === subject) {
        return account;
      }
    } catch {
      // No saved login for this account.
    }
  }

  return null;
}

// Reads a token's claims without checking its signature. Only used to
// show who logged in and to link that identity locally; the API always
// verifies tokens properly.
export function unverifiedClaims(
  token: string
): Record<string, unknown> {
  const payload = token.split(".")[1];

  if (!payload) {
    throw new Error("The access token is not a JWT");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}