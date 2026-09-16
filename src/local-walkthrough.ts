// src/local-walkthrough.ts
//
// Runs the whole workflow against the local server and prints each step:
// observations, a Claude-written draft, review, evaluation, approval,
// publication, the parent's view, and requests that must be refused.
//
// Every refusal is checked, not just printed. If anyone gets access they
// should not have, the walkthrough stops with a security failure.
//
// Start the local server first (npm run local:server), then run:
//   npm run local:walkthrough
//
// With real login (npm run auth:server), run npm run auth:walkthrough
// instead. It sends each account's saved login token rather than naming
// a demo user.

import {
    loadToken,
    type DemoAccount,
    type SavedToken,
  } from "./demo-accounts.js";
  
  const realLogin = process.env.WALKTHROUGH_AUTH === "tokens";
  
  const baseUrl = `http://127.0.0.1:${process.env.PORT ?? 3001}`;
  const childId = "demo-ava";
  
  type User = DemoAccount;
  
  const tokens = new Map<User, SavedToken>();
  
  if (realLogin) {
    const users: User[] = ["practitioner", "approver", "parent", "outsider"];
  
    for (const user of users) {
      const token = await loadToken(user);
  
      if (token) {
        tokens.set(user, token);
      } else if (user !== "outsider") {
        console.error(
          `No current login for ${user}. ` +
            `Run: npm run auth:login -- ${user}`
        );
        process.exit(1);
      }
    }
  
    // Each demo account must be a different person. If two logins share an
    // identity, the role checks below would test the wrong thing.
    const seen = new Map<string, User>();
  
    for (const [user, token] of tokens) {
      const identity = `${token.issuer} ${token.subject}`;
      const other = seen.get(identity);
  
      if (other) {
        console.error(
          `\nThe ${other} and ${user} logins are the same Auth0 user ` +
            `(${token.subject}).` +
            "\nThat happens when a browser reuses an earlier login. To fix it:" +
            "\n  1. npm run local:db   (clears the mixed-up roles)" +
            `\n  2. npm run auth:login -- ${user}   in a new private window,` +
            ` signing in as the ${user} account` +
            "\n  3. npm run auth:link for every account again"
        );
        process.exit(1);
      }
  
      seen.set(identity, user);
    }
  }
  
  function credentials(user: User): Record<string, string> {
    if (!realLogin) {
      return { "x-local-user": user };
    }
  
    const token = tokens.get(user);
  
    return token ? { authorization: `Bearer ${token.accessToken}` } : {};
  }
  
  type Response = {
    status: number;
    body: any;
  };
  
  async function send(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    let response: globalThis.Response;
  
    try {
      response = await fetch(`${baseUrl}${path}`, init);
    } catch {
      console.error(
        `\nCould not reach ${baseUrl}. Start the local server first: ` +
          (realLogin ? "npm run auth:server" : "npm run local:server")
      );
      process.exit(1);
    }
  
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }
  
  async function call(
    user: User,
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<Response> {
    return send(path, {
      method,
      headers: {
        ...credentials(user),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  
  function step(title: string) {
    console.log(`\n=== ${title}`);
  }
  
  function expect(response: Response, status: number, action: string) {
    if (response.status === 401) {
      console.error(
        `\n${action} was refused as not logged in (401).` +
          (realLogin
            ? "\nCheck the server is running with npm run auth:server, " +
              "and that each account has been linked with npm run auth:link."
            : "\nCheck the server is running with npm run local:server.")
      );
      process.exit(1);
    }
  
    if (response.status !== status) {
      console.error(`\n${action} returned ${response.status}, expected ${status}:`);
      console.error(JSON.stringify(response.body, null, 2));
      process.exit(1);
    }
  }
  
  // A request that must not succeed. Anything else is a security failure.
  function expectRefused(
    response: Response,
    status: 401 | 403,
    description: string
  ) {
    if (response.status !== status) {
      console.error(
        `\nSECURITY CHECK FAILED: ${description} returned ` +
          `${response.status}, expected ${status}.`
      );
      console.error(JSON.stringify(response.body, null, 2));
      process.exit(1);
    }
  
    console.log(`  Refused (${status}): ${description}`);
  }
  
  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  
  const observations = [
    {
      category: "activity",
      text: "Built a tall tower with Oliver using wooden blocks.",
    },
    {
      category: "food",
      text: "Ate most of her pasta and all of her apple.",
    },
    {
      category: "sleep",
      text: "Slept for 45 minutes after lunch.",
    },
  ] as const;
  
  // Each child has at most one update per date, so use the first date
  // from today that has no observations yet.
  async function freeDate(): Promise<string> {
    const existing = await call(
      "practitioner",
      "GET",
      `/children/${childId}/observations`
    );
  
    expect(existing, 200, "Reading observations");
  
    const used = new Set(
      existing.body.observations.map(
        (observation: { observation_date: string }) =>
          observation.observation_date
      )
    );
  
    const date = new Date();
  
    while (used.has(isoDate(date))) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
  
    return isoDate(date);
  }
  
  const date = await freeDate();
  
  console.log(
    `Walking through a day for Ava on ${date}, using ${baseUrl}` +
      (realLogin ? " with real login tokens" : "")
  );
  
  step("1. The practitioner records observations");
  
  for (const observation of observations) {
    const response = await call("practitioner", "POST", "/observations", {
      childId,
      observationDate: date,
      ...observation,
    });
  
    expect(response, 201, "Recording an observation");
    console.log(`  [${observation.category}] ${observation.text}`);
  }
  
  step("2. Claude writes the draft");
  
  const generated = await call("practitioner", "POST", "/drafts/generate", {
    childId,
    observationDate: date,
  });
  
  expect(generated, 201, "Generating a draft");
  
  const draft = generated.body.draft;
  
  console.log(`  ${draft.text}`);
  console.log(
    "  (With real Claude, Oliver should appear as 'a friend'. " +
      "Fake AI just copies the observations.)"
  );
  
  step("3. A separate Claude review checks it against the observations");
  
  const reviewed = await call(
    "practitioner",
    "POST",
    `/revisions/${draft.id}/content-reviews`
  );
  
  expect(reviewed, 201, "Reviewing the draft");
  
  console.log(`  Grounding: ${reviewed.body.verdict}. ${reviewed.body.reason}`);
  console.log(
    `  Coverage: ${reviewed.body.coverage.verdict}` +
      (reviewed.body.coverage.missing.length > 0
        ? `, missing ${reviewed.body.coverage.missing.join(", ")}`
        : "")
  );
  
  step("4. The evaluation rules decide whether it can be approved");
  
  const evaluated = await call(
    "practitioner",
    "POST",
    `/revisions/${draft.id}/evaluations`
  );
  
  expect(evaluated, 201, "Evaluating the draft");
  
  for (const result of evaluated.body.results) {
    console.log(`  ${result.outcome.padEnd(6)} ${result.ruleId}: ${result.reason}`);
  }
  
  console.log(`  Decision: ${evaluated.body.decision}`);
  
  const evaluationId = evaluated.body.evaluationId;
  
  step("5. The practitioner is not allowed to approve");
  
  expectRefused(
    await call("practitioner", "POST", `/evaluation-runs/${evaluationId}/approval`),
    403,
    "the practitioner approving"
  );
  
  expectRefused(
    await call("parent", "POST", `/evaluation-runs/${evaluationId}/approval`),
    403,
    "the parent approving"
  );
  
  if (evaluated.body.decision !== "eligible") {
    console.log(
      "\nThe draft was not eligible, so it stops here for a person to fix." +
        "\nThis is the system working: edit the draft with" +
        `\nPOST /updates/${draft.update_id}/revisions, then review and` +
        " evaluate again."
    );
    process.exit(0);
  }
  
  step("6. The approver approves and publishes");
  
  const approved = await call(
    "approver",
    "POST",
    `/evaluation-runs/${evaluationId}/approval`
  );
  
  expect(approved, 201, "Approving");
  console.log("  Approved.");
  
  const approvalId = approved.body.approval.id;
  
  expectRefused(
    await call("practitioner", "POST", `/revision-approvals/${approvalId}/publication`),
    403,
    "the practitioner publishing"
  );
  
  const published = await call(
    "approver",
    "POST",
    `/revision-approvals/${approvalId}/publication`
  );
  
  expect(published, 201, "Publishing");
  console.log("  Published.");
  
  step("7. Ava's parent reads the update");
  
  const parentView = await call(
    "parent",
    "GET",
    `/children/${childId}/published-updates`
  );
  
  expect(parentView, 200, "Reading as the parent");
  
  const latest = parentView.body.updates.find(
    (update: { observation_date: string }) => update.observation_date === date
  );
  
  if (!latest) {
    console.error("\nThe parent cannot see the update that was just published.");
    process.exit(1);
  }
  
  console.log(`  ${latest.text}`);
  console.log(`  Fields the parent receives: ${Object.keys(latest).join(", ")}`);
  
  step("8. People without access are refused");
  
  if (!realLogin || tokens.has("outsider")) {
    expectRefused(
      await call("outsider", "GET", `/children/${childId}/published-updates`),
      403,
      "an approver from another setting reading Ava's updates"
    );
  
    expectRefused(
      await call("outsider", "POST", `/revisions/${draft.id}/evaluations`),
      403,
      "an approver from another setting evaluating Ava's draft"
    );
  } else {
    console.log(
      "  (Skipped the other-setting checks: the outsider account " +
        "has not logged in.)"
    );
  }
  
  expectRefused(
    await call("parent", "GET", "/children/other-sam/published-updates"),
    403,
    "Ava's parent reading another child's updates"
  );
  
  expectRefused(
    await call("parent", "GET", `/children/${childId}/observations`),
    403,
    "Ava's parent reading staff observations"
  );
  
  expectRefused(
    await call("parent", "POST", "/drafts/generate", {
      childId,
      observationDate: date,
    }),
    403,
    "the parent generating a draft"
  );
  
  if (realLogin) {
    expectRefused(
      await send(`/children/${childId}/published-updates`, {
        headers: {
          authorization: `Bearer ${tokens.get("parent")?.accessToken}x`,
        },
      }),
      401,
      "a tampered login token"
    );
  
    expectRefused(
      await send(`/children/${childId}/published-updates`, {
        headers: { "x-local-user": "approver" },
      }),
      401,
      "the local-only x-local-user header"
    );
  }
  
  expectRefused(
    await send(`/children/${childId}/published-updates`, {}),
    401,
    "a request with no login"
  );
  
  console.log("\nDone. Every access check behaved correctly.");