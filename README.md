<!-- README.md -->
# Daily Updates

[![CI](https://github.com/KathrynLamb/daily-updates/actions/workflows/ci.yml/badge.svg)](https://github.com/KathrynLamb/daily-updates/actions/workflows/ci.yml)

A safety-first backend for turning childcare observations into reviewed, approved, and immutable parent updates.

Claude writes the first draft from a practitioner's observations. The service preserves the evidence behind every draft, uses a separate structured AI review to assess whether claims are grounded, calculates observation coverage deterministically, and publishes only an exact revision that has passed evaluation and received human approval.

Authentication, tenant isolation, role-based authorization, actor attribution, and database constraints protect every stage of the workflow.

## Why this exists

Daily updates contain sensitive information and are read by families as factual records. An AI-generated draft should never be published merely because a model says it looks acceptable.

This project treats AI review as one piece of evidence inside a controlled workflow:

1. A practitioner records observations.
2. Claude writes a draft from those observations, or a practitioner writes one by hand.
3. The draft revision captures an immutable snapshot of its sources.
4. A separate Claude review checks whether the draft’s claims are grounded in those observations.
5. Application code calculates whether every observation was covered.
6. Deterministic evaluation rules decide whether the revision is eligible.
7. An approver in the child’s setting approves that exact eligible evaluation.
8. An approver or administrator publishes an immutable snapshot.
9. Only authorized staff and explicitly linked parents can read the published update.

## Safety properties

### Evidence

- Draft revisions and their source snapshots are immutable.
- Completed AI reviews cannot be changed.
- Completed evaluation runs and their results cannot be changed.
- Grounding and coverage are evaluated independently.
- Coverage is calculated from observation IDs rather than a model-generated verdict.
- Invalid structured output is rejected locally before it can be stored.
- Missing, stale, malformed, duplicate, or unknown evaluation results cannot produce eligibility.
- Provider failures never become passing content reviews.
- Every draft generation attempt is recorded with who requested it, the model, the prompt, and exactly what the model was sent, and cannot be changed once finished.
- A revision marked as generated must contain exactly the text the model returned, from exactly the observations it was given. PostgreSQL enforces this.
- Failed or incomplete generations never become drafts.

### Approval and publication

- Approval applies to one exact eligible evaluation and draft revision.
- Approval and publication both recheck that the revision, evaluator, policy, content review, stored results, and source observations are still current.
- The shared evidence checks live in one module so approval and publication cannot silently develop different rules.
- Every new approval records the authenticated person who made it.
- Every new publication records the authenticated person who published it.
- Historical approvals without actor attribution remain stored but cannot authorize a new publication.
- Approval and publication endpoints are idempotent.
- Parent-facing responses expose only published text, never drafts, observations, reviews, evaluation evidence, or staff identities.

### Authentication

- Every endpoint except `GET /health` requires authentication.
- Access tokens are verified using OpenID Connect and the provider’s JSON Web Key Set.
- Verification checks the token signature, issuer, audience, expiry, and an explicit signing-algorithm allowlist.
- A verified external identity is mapped to an active internal user using its issuer and subject.
- The service never trusts an internal user ID supplied by the caller.
- Invalid credentials produce `401 Authentication required`.
- Identity-provider, key-service, or database failures produce `503 Authentication unavailable` rather than being misreported as user errors.
- The OIDC implementation is provider-independent; deployment supplies the issuer, audience, and JWKS endpoint.

### Authorization and tenant isolation

- Staff access comes from membership of a setting.
- Each staff role grants a fixed set of capabilities.
- Parents receive access only through explicit links to individual children.
- Disabled users lose access.
- Tenant access is enforced in setting-scoped SQL or inside the transaction performing the action.
- Operations that require stable authorization lock the relevant membership records until the transaction completes.
- Missing records and records belonging to another setting return the same `403` response, preventing identifier probing.
- PostgreSQL independently rejects approvals and publications made by users without the required role, even if a future code path bypasses an API check.

## Roles

| Capability | Practitioner | Approver | Admin | Linked parent |
| --- | :---: | :---: | :---: | :---: |
| Record and read observations | ✓ | ✓ | ✓ |  |
| Create drafts and revisions | ✓ | ✓ | ✓ |  |
| Request content review and evaluation | ✓ | ✓ | ✓ |  |
| Approve an eligible evaluation |  | ✓ | ✓ |  |
| Publish an approved revision |  | ✓ | ✓ |  |
| Read published updates | ✓ | ✓ | ✓ | ✓ |

Staff capabilities apply only within the setting where the user has membership. A parent has no general setting access and can read updates only for explicitly linked children.

The capability mapping lives in `src/authorization.ts`. PostgreSQL repeats the critical approval and publication role checks as a defense-in-depth measure.

## Technology

- Node.js 24
- TypeScript
- Fastify
- PostgreSQL
- Zod
- `jose` for OIDC and JWT verification
- Anthropic Claude structured outputs
- Node test runner
- Docker Compose
- GitHub Actions

## Architecture

| Component | Responsibility |
| --- | --- |
| Authentication | Verifies bearer tokens and maps external identities to active application users |
| Authorization | Maps staff roles to capabilities and parents to explicitly linked children |
| Observations | Stores the source facts recorded for a child and date |
| Draft revisions | Preserves draft text and the exact source snapshot used to create it |
| Draft generation | Asks Claude for a draft and records every attempt |
| Content reviews | Stores structured grounding evidence returned by Claude |
| Coverage resolver | Computes covered, missing, and unknown observation IDs |
| Evaluations | Combines deterministic rules with content-review evidence |
| Approval evidence | Rechecks that all evidence remains current before approval or publication |
| Approvals | Records who authorized one exact eligible revision |
| Publications | Stores the immutable parent-facing snapshot and who published it |

## Evaluation decision model

An evaluation becomes `eligible` only when all five required rules pass:

- `text_length`
- `source_presence`
- `source_freshness`
- `content_grounding`
- `content_coverage`

A failed rule produces `blocked`.

A missing, unknown, duplicate, errored, or review-required result produces `needs_review`. The application therefore cannot grant eligibility merely because the rules it happened to receive passed.

## Draft generation

`POST /drafts/generate` writes a first draft for a child and date. `POST /updates/:updateId/generations` writes a new revision from the current observations.

Claude receives only the child's first name, the date, and the observations. The prompt (`src/generation-schema.ts`) requires every observation to be included, forbids facts that are not in them, applies the same rule on feelings and motives as the reviewer, keeps other children anonymous, and treats observation text as data rather than instructions. The prompt is versioned, and the version and full text are stored with every generation.

Generation and review are separate calls with separate prompts and different models, so the model does not mark its own work.

Each request runs in three steps, so no database transaction is held open while the model is writing:

1. Check access, collect the observations, and record the attempt.
2. Call the model and record either the draft or the failure.
3. Check access and the latest revision again, then save the draft.

If a colleague saves a revision while the model is writing, their edit stands. The generated text is kept as history and the request returns `409`.

A generated draft then goes through exactly the same review, evaluation, approval, and publication as a hand-written one.

To try the real models, run `npx tsx src/check-generation.ts`. It generates drafts for a few difficult cases (another child named, a negation, an injury, an instruction hidden in an observation) and reviews each one. It calls the Anthropic API.

## Structured AI review

Claude receives the child’s name, the observation IDs and text, and the proposed draft.

It returns:

- a grounding verdict;
- a reason for that verdict;
- the IDs of observations represented by the draft;
- an explanation of its coverage selection.

The model does **not** decide the final coverage verdict.

Application code compares the returned IDs with the supplied observation IDs and calculates:

- covered observations;
- missing observations;
- unknown IDs returned by the model;
- a final `complete` or `incomplete` coverage verdict.

Evaluation passes coverage only when the verdict is `complete` **and** the model returned no unknown IDs. A review that cites observations it was never given is treated as unreliable and sent to human review, even if every supplied observation appears. The review-based rules live in `src/review-rules.ts` as pure functions with their own unit tests.

Whenever the meaning of a rule changes, the evaluator version is bumped. Evaluations recorded under an older version can no longer be approved or published.

The wire JSON Schema is generated directly from Zod and passed to the Anthropic API without the SDK schema helper. During development, the helper was found to remove enum constraints from the transmitted schema.

The response is also validated locally with Zod before it can be stored.

## Database history and immutability

The migrations in `db/migrations` build the database in order and include protections for:

- immutable draft revisions;
- immutable evaluation-policy versions;
- immutable completed content reviews;
- immutable completed evaluation runs and results;
- who recorded each observation, saved each draft revision, and requested each AI review and evaluation;
- an immutable history of every draft generation attempt, and generated revisions that must match their generation exactly;
- actor-attributed approvals;
- actor-attributed publications;
- tenant memberships and parent-child access;
- refusal to publish from a historical approval that has no recorded approver.

Critical invariants are enforced in PostgreSQL as well as in the application. This protects the workflow from future API routes, scripts, or manual queries that might otherwise omit an application-level check.

## Running the verification suite

### Requirements

- Node.js 24
- Docker Desktop with Docker Compose

Install the exact locked dependencies:

```bash
npm ci
```

Run type checking and the complete test suite:

```bash
npm run typecheck
npm run test:all
```

`test:all` runs:

- 90 deterministic unit and route tests;
- a disposable PostgreSQL container;
- every migration against a clean database;
- 13 end-to-end database workflow tests.

The integration tests cover:

- cross-setting access refusal;
- the complete observation-to-publication workflow;
- parent responses containing only the immutable published snapshot;
- incomplete coverage that cannot be approved;
- approval refusal when evidence changes after evaluation;
- publication refusal when evidence changes after approval;
- role enforcement through both the API and PostgreSQL;
- parent reads limited to explicitly linked children;
- refusal to publish from an unattributed historical approval;
- evaluation that sends a review citing unsupplied observation IDs to human review;
- attribution of every observation, revision, review, and evaluation to the person who created it;
- a Claude-written draft passing through review, approval, publication, and a parent read;
- failed generations recorded without creating a draft;
- generation refused before the model is called for other settings, parents, existing updates, and dates without observations;
- regeneration that uses current observations and never overwrites an edit saved while the model was writing;
- database refusal of generated revisions that do not match their generation.

Tests inject a deterministic draft generator, content reviewer, and test authenticator. They do not call the live Anthropic API or a live identity provider.

## Running the service locally

Copy the environment template:

```bash
cp .env.example .env
```

Configure:

- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_JWKS_URL`
- `AUTH_ALGORITHMS`

Apply the SQL migrations in filename order, then start the API:

```bash
npm run dev
```

The service listens on `http://127.0.0.1:3001` by default.

The health endpoint is public:

```bash
curl http://127.0.0.1:3001/health
```

All business endpoints require a bearer token from the configured identity provider. The verified token identity must match an active row in `app_users`.

## Trying it locally

You can run the whole workflow on your own computer, with made-up users and no identity provider. You need Docker Desktop running.

1. Create a fresh local database with demo data. This deletes any previous local data.

   ```bash
   npm run local:db
   ```

2. Start the local server and leave it running.

   ```bash
   npm run local:server
   ```

   This uses real Claude, so `ANTHROPIC_API_KEY` must be set in `.env`. A full walkthrough costs a few cents. To try the flow without an API key, run `LOCAL_AI=fake npm run local:server` instead.

3. In a second terminal, run the walkthrough.

   ```bash
   npm run local:walkthrough
   ```

   It records observations, has Claude write and review a draft, evaluates it, approves and publishes it, shows what the parent sees, and shows requests from people without access being refused. Run it as often as you like; each run uses the next unused date.

The local server replaces login with an `x-local-user` header naming one of the demo users in `db/seed.sql`: `practitioner`, `approver`, `parent` or `outsider`. It is a separate entry point that production never uses, and it refuses to start unless both the server and the database are on your own computer.

To try individual requests:

```bash
curl -s -X POST http://127.0.0.1:3001/observations \
  -H 'x-local-user: practitioner' -H 'content-type: application/json' \
  -d '{"childId":"demo-ava","observationDate":"2026-12-01","category":"activity","text":"Planted sunflower seeds."}'

curl -s -X POST http://127.0.0.1:3001/drafts/generate \
  -H 'x-local-user: practitioner' -H 'content-type: application/json' \
  -d '{"childId":"demo-ava","observationDate":"2026-12-01"}'

curl -s http://127.0.0.1:3001/children/demo-ava/published-updates \
  -H 'x-local-user: parent'
```

## Real login

The local server can also require real login tokens from an identity provider, checked by the same code as production. These steps use Auth0, whose free plan is enough; any OpenID Connect provider that issues signed JWT access tokens works the same way.

### Set up Auth0 (once)

1. **Create a tenant** at auth0.com. Its domain looks like `your-tenant.eu.auth0.com`.
2. **Create an API** (Applications → APIs → Create API). Give it an identifier such as `https://daily-updates-api` and keep the RS256 signing algorithm. This identifier is the token audience.
3. **Create an application for the terminal login** (Applications → Applications → Create Application → Native). In its settings, under Advanced Settings → Grant Types, make sure **Device Code** is enabled. Copy its Client ID.
4. **Stop strangers signing up.** Under Authentication → Database → Username-Password-Authentication, turn on **Disable Sign Ups**. Only accounts you create can log in.
5. **Create the demo accounts** (User Management → Users → Create User), one each for `practitioner`, `approver`, `parent`, and optionally `outsider`. Use made-up addresses you control and strong, unique passwords.
6. **Add the settings to `.env`:**

   ```bash
   AUTH_ISSUER=https://your-tenant.eu.auth0.com/
   AUTH_AUDIENCE=https://daily-updates-api
   AUTH_JWKS_URL=https://your-tenant.eu.auth0.com/.well-known/jwks.json
   AUTH_ALGORITHMS=RS256
   AUTH_CLI_CLIENT_ID=the-client-id-from-step-3
   ```

   The issuer must match exactly, including the trailing slash.

### Try it

With the local database created (`npm run local:db`):

```bash
# Once per account: sign in on Auth0's page, then give the account its role.
npm run auth:login -- practitioner
npm run auth:link -- practitioner
# ...repeat for approver, parent and, optionally, outsider.

# Terminal 1: the local server, now requiring real tokens.
npm run auth:server

# Terminal 2: the walkthrough, using the saved tokens.
npm run auth:walkthrough
```

Sign in each account in a private browser window, so Auth0 does not reuse the previous account's session. Tokens are saved in `.tokens/`, which git ignores, and expire after the lifetime set on the Auth0 API (a day by default); run `auth:login` again when they do. `auth:link` only needs repeating after `npm run local:db` resets the database.

In this mode the `x-local-user` header is ignored, and the walkthrough also shows a tampered token being refused. `LOCAL_AI=fake npm run auth:server` tests real login without calling Claude.

## Main API workflow

| Action | Endpoint | Authorized users |
| --- | --- | --- |
| Create observation | `POST /observations` | Staff in the child’s setting |
| Read observations | `GET /children/:childId/observations` | Staff in the child’s setting |
| Generate initial draft | `POST /drafts/generate` | Staff in the child’s setting |
| Generate new revision | `POST /updates/:updateId/generations` | Staff in the child’s setting |
| Create initial draft by hand | `POST /drafts` | Staff in the child’s setting |
| Create draft revision | `POST /updates/:updateId/revisions` | Staff in the child’s setting |
| Review content | `POST /revisions/:revisionId/content-reviews` | Staff in the child’s setting |
| Evaluate revision | `POST /revisions/:revisionId/evaluations` | Staff in the child’s setting |
| Approve evaluation | `POST /evaluation-runs/:evaluationRunId/approval` | Approver or admin |
| Publish approval | `POST /revision-approvals/:approvalId/publication` | Approver or admin |
| Read published updates | `GET /children/:childId/published-updates` | Staff or linked parents |

## Continuous integration

GitHub Actions runs the following for every push and pull request:

1. Dependency installation from `package-lock.json`.
2. Type checking.
3. Unit and route tests.
4. Clean database migrations.
5. Database integration tests.

The CI badge at the top of this file links to the latest workflow results.

## Current scope and known limitations

This repository demonstrates the core generation, evidence, review, authorization, approval, and publishing workflow. It is not presented as a complete deployed childcare product.

Known limitations include:

- Real login works locally with any OpenID Connect provider (Auth0 steps above), but the API is not yet deployed anywhere.
- Users, setting memberships, roles, and parent-child links are administered directly in PostgreSQL; there is no user-administration interface.
- The AI review evaluation set contains 11 cases and each baseline currently represents one run. Draft generation has a live smoke check but no scored evaluation set yet.
- Generation has no rate limit or per-setting cost control.
- There is no frontend client in this repository.
- Rate limiting, production observability, backups, operational alerting, and secrets management remain deployment responsibilities.

These limitations are documented explicitly so future work can strengthen the system without obscuring what the current implementation guarantees.