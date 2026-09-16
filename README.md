# Daily Updates

[![CI](https://github.com/KathrynLamb/daily-updates/actions/workflows/ci.yml/badge.svg)](https://github.com/KathrynLamb/daily-updates/actions/workflows/ci.yml)

A safety-first backend for turning childcare observations into reviewed, approved, and immutable parent updates.

The service preserves the evidence behind every draft, uses structured AI review to assess whether claims are grounded, calculates observation coverage deterministically, and publishes only an exact revision that has passed evaluation and received human approval.

Authentication, tenant isolation, role-based authorization, actor attribution, and database constraints protect every stage of the workflow.

## Why this exists

Daily updates contain sensitive information and are read by families as factual records. An AI-generated draft should never be published merely because a model says it looks acceptable.

This project treats AI review as one piece of evidence inside a controlled workflow:

1. A practitioner records observations.
2. A draft revision captures an immutable snapshot of its sources.
3. Claude checks whether the draft’s claims are grounded in those observations.
4. Application code calculates whether every observation was covered.
5. Deterministic evaluation rules decide whether the revision is eligible.
6. An approver in the child’s setting approves that exact eligible evaluation.
7. An approver or administrator publishes an immutable snapshot.
8. Only authorized staff and explicitly linked parents can read the published update.

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

The wire JSON Schema is generated directly from Zod and passed to the Anthropic API without the SDK schema helper. During development, the helper was found to remove enum constraints from the transmitted schema.

The response is also validated locally with Zod before it can be stored.

## Database history and immutability

The migrations in `db/migrations` build the database in order and include protections for:

- immutable draft revisions;
- immutable evaluation-policy versions;
- immutable completed content reviews;
- immutable completed evaluation runs and results;
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

- 61 deterministic unit and route tests;
- a disposable PostgreSQL container;
- every migration against a clean database;
- 6 end-to-end database workflow tests.

The integration tests cover:

- cross-setting access refusal;
- the complete observation-to-publication workflow;
- parent responses containing only the immutable published snapshot;
- incomplete coverage that cannot be approved;
- approval refusal when evidence changes after evaluation;
- publication refusal when evidence changes after approval;
- role enforcement through both the API and PostgreSQL;
- parent reads limited to explicitly linked children;
- refusal to publish from an unattributed historical approval.

Tests inject a deterministic content reviewer and test authenticator. They do not call the live Anthropic API or a live identity provider.

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

## Main API workflow

| Action | Endpoint | Authorized users |
| --- | --- | --- |
| Create observation | `POST /observations` | Staff in the child’s setting |
| Read observations | `GET /children/:childId/observations` | Staff in the child’s setting |
| Create initial draft | `POST /drafts` | Staff in the child’s setting |
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

This repository demonstrates the core evidence, review, authorization, approval, and publishing workflow. It is not presented as a complete deployed childcare product.

Known limitations include:

- An OIDC/JWKS verifier is implemented, but a specific production identity-provider tenant is not provisioned in this repository.
- Users, setting memberships, roles, and parent-child links are administered directly in PostgreSQL; there is no user-administration interface.
- Unknown observation IDs returned by the reviewer are recorded but do not currently block approval. They should eventually route the draft to human review.
- The AI evaluation set contains 11 cases and each baseline currently represents one run.
- There is no frontend client in this repository.
- Rate limiting, production observability, backups, operational alerting, and secrets management remain deployment responsibilities.
- Actor attribution currently covers approvals and publications rather than every evidence-creation action.

These limitations are documented explicitly so future work can strengthen the system without obscuring what the current implementation guarantees.