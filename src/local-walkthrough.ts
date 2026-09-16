// src/local-walkthrough.ts
//
// Runs the whole workflow against the local server and prints each step:
// observations, a Claude-written draft, review, evaluation, approval,
// publication, the parent's view, and a few refused requests.
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
  }
  
  function credentials(user: User): Record<string, string> {
    if (!realLogin) {
      return { "x-local-user": user };
    }
  
    const token = tokens.get(user);
  
    return token
      ? { authorization: `Bearer ${token.accessToken}` }
      : {};
  }
  
  type Response = {
    status: number;
    body: any;
  };
  
  async function call(
    user: User,
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<Response> {
    let response: globalThis.Response;
  
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...credentials(user),
          ...(body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      console.error(
        `\nCould not reach ${baseUrl}. ` +
          "Start the local server first: npm run local:server"
      );
      process.exit(1);
    }
  
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
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
      console.error(
        `\n${action} returned ${response.status}, expected ${status}:`
      );
      console.error(JSON.stringify(response.body, null, 2));
      process.exit(1);
    }
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
  
  const practitionerApproval = await call(
    "practitioner",
    "POST",
    `/evaluation-runs/${evaluationId}/approval`
  );
  
  console.log(`  ${practitionerApproval.status} ${practitionerApproval.body?.error}`);
  
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
  
  const published = await call(
    "approver",
    "POST",
    `/revision-approvals/${approved.body.approval.id}/publication`
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
    (update: { observation_date: string }) =>
      update.observation_date === date
  );
  
  console.log(`  ${latest?.text}`);
  console.log(
    `  Fields the parent receives: ${Object.keys(latest ?? {}).join(", ")}`
  );
  
  step("8. People without access are refused");
  
  if (!realLogin || tokens.has("outsider")) {
    const outsiderView = await call(
      "outsider",
      "GET",
      `/children/${childId}/published-updates`
    );
  
    console.log(
      `  Approver from another setting reads Ava: ${outsiderView.status}`
    );
  } else {
    console.log(
      "  (Skipped the other-setting check: the outsider account " +
        "has not logged in.)"
    );
  }
  
  const parentOther = await call(
    "parent",
    "GET",
    "/children/other-sam/published-updates"
  );
  
  console.log(`  Ava's parent reads another child: ${parentOther.status}`);
  
  const parentDraft = await call("parent", "POST", "/drafts/generate", {
    childId,
    observationDate: date,
  });
  
  console.log(`  Parent tries to generate a draft: ${parentDraft.status}`);
  
  if (realLogin) {
    const forged = await fetch(
      `${baseUrl}/children/${childId}/published-updates`,
      {
        headers: {
          authorization: `Bearer ${tokens.get("parent")?.accessToken}x`,
        },
      }
    );
  
    console.log(`  A tampered login token: ${forged.status}`);
  
    const localHeader = await fetch(
      `${baseUrl}/children/${childId}/published-updates`,
      { headers: { "x-local-user": "approver" } }
    );
  
    console.log(
      `  The local-only x-local-user header: ${localHeader.status}`
    );
  }
  
  console.log("\nDone.");