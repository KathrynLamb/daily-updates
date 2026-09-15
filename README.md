# Daily Updates

A safety-first backend for turning childcare observations into reviewed, approved, and immutable parent updates.

The system preserves the evidence behind every draft, uses structured AI review to assess grounding, computes observation coverage deterministically, and only publishes an exact revision after it passes evaluation and approval.

## Why this exists

Daily updates contain sensitive information and are read by families as factual records. An AI-generated draft should therefore never be published merely because a model says it looks acceptable.

This project treats AI review as evidence inside a wider controlled workflow:

1. Practitioners record observations.
2. A draft revision captures an immutable snapshot of its sources.
3. Claude checks whether every claim is grounded in those observations.
4. Application code calculates whether every observation was covered.
5. Deterministic evaluation rules decide whether the revision is eligible.
6. Approval references the exact eligible evaluation.
7. Publication creates an immutable parent-facing snapshot.

## Safety properties

- Draft revisions and their source snapshots are immutable.
- Completed AI reviews cannot be changed.
- Completed evaluation runs and results cannot be changed.
- Grounding and coverage are evaluated independently.
- Coverage is calculated from observation IDs rather than a model-generated verdict.
- Missing, malformed, stale, duplicate, or unknown evidence fails closed.
- Approval only applies to the latest exact eligible revision.
- Publication only accepts a valid approval.
- Approval and publication endpoints are idempotent.
- Parent-facing reads expose only the published text snapshot.
- Provider failures never become passing reviews.

## Technology

- TypeScript
- Fastify
- PostgreSQL
- Zod
- Anthropic Claude
- Node test runner
- Docker Compose
- GitHub Actions

## Architecture

| Component | Responsibility |
| --- | --- |
| Observations | Store the source facts recorded for a child and date |
| Draft revisions | Preserve draft text and the exact source snapshot |
| Content reviews | Store structured grounding evidence from Claude |
| Coverage resolver | Compute covered, missing, and unknown observation IDs |
| Evaluations | Combine deterministic rules and review evidence |
| Approvals | Authorise one exact eligible revision |
| Publications | Store the immutable parent-facing snapshot |

## Decision model

An evaluation becomes `eligible` only when these five required rules all pass:

- `text_length`
- `source_presence`
- `source_freshness`
- `content_grounding`
- `content_coverage`

A failed rule produces `blocked`. Missing, unknown, duplicate, errored, or review-required evidence produces `needs_review`.

## Structured AI review

Claude returns a grounding verdict and the IDs of observations represented by the draft.

The model does **not** decide the final coverage verdict. The application compares the returned IDs with the supplied observation IDs and computes:

- covered observations
- missing observations
- unknown returned IDs
- `complete` or `incomplete`

The wire JSON Schema is generated directly from Zod and sent without the Anthropic SDK schema helper. This preserves enum constraints that the helper version used during development removed from the transmitted schema.

The response is also validated locally with Zod before it can be stored.

## Running the verification suite

Requirements:

- Node.js 20
- Docker Desktop with Docker Compose

Install dependencies:

```bash
npm ci
```

Run type checking and every test:

```bash
npm run typecheck
npm run test:all
```

`test:all` runs:

- 35 deterministic unit and route tests
- a disposable PostgreSQL container
- all database migrations from a clean database
- end-to-end workflow integration tests
- a complete review, evaluation, approval, publication, and parent-read path
- a negative test proving incomplete coverage cannot be approved

Integration tests inject a deterministic reviewer and do not call the live Anthropic API.

## Running the service locally

Copy the environment template:

```bash
cp .env.example .env
```

Set a PostgreSQL connection and Anthropic API key in `.env`, apply the migrations in `db/migrations`, and start the API:

```bash
npm run dev
```

The service listens on `http://127.0.0.1:3001` by default.

Health check:

```bash
curl http://127.0.0.1:3001/health
```

## Main API workflow

| Action | Endpoint |
| --- | --- |
| Create observation | `POST /observations` |
| Create initial draft | `POST /drafts` |
| Create draft revision | `POST /updates/:updateId/revisions` |
| Review content | `POST /revisions/:revisionId/content-reviews` |
| Evaluate revision | `POST /revisions/:revisionId/evaluations` |
| Approve evaluation | `POST /evaluation-runs/:evaluationRunId/approval` |
| Publish approval | `POST /revision-approvals/:approvalId/publication` |
| Read published updates | `GET /children/:childId/published-updates` |

## Continuous integration

GitHub Actions runs type checking, unit tests, clean database migrations, and integration tests for every push and pull request.

## Current scope

This repository demonstrates the core safety and publishing workflow. A full deployed product would additionally require authenticated users, setting-level authorisation, secrets management, audit access controls, request rate limiting, production observability, backups, and operational alerting.