// app/src/types.ts
//
// The shapes the API returns, as far as the app uses them.

export type ChildSummary = {
  id: string;
  firstName: string;
};

export type StaffMembership = {
  settingId: string;
  settingName: string;
  role: string;
  capabilities: string[];
  children: ChildSummary[];
};

export type Me = {
  user: { id: string };
  staff: StaffMembership[];
  parentOf: ChildSummary[];
};

export type ObservationCategory = "activity" | "food" | "sleep" | "general";

export type Observation = {
  id: string;
  child_id: string;
  observation_date: string;
  category: ObservationCategory;
  text: string;
};

export type RuleResult = {
  ruleId: string;
  outcome: "pass" | "fail" | "review" | "error";
  reason: string;
};

export type UpdateStatus =
  | "published"
  | "approved"
  | "ready_for_approval"
  | "needs_review"
  | "blocked"
  | "evaluating"
  | "evaluation_failed"
  | "reviewed"
  | "draft";

export type StaffUpdate = {
  id: string;
  observationDate: string;
  status: UpdateStatus;
  revision: {
    id: string;
    number: number;
    text: string;
    generated: boolean;
  };
  review: {
    status: string;
    verdict: string | null;
    reason: string | null;
    coverageVerdict: string | null;
    coverageReason: string | null;
  } | null;
  evaluation: {
    id: string;
    status: string;
    decision: string | null;
    results: RuleResult[];
  } | null;
  approval: { id: string } | null;
  publication: { id: string; revisionId: string } | null;
};

export type QueueItem = {
  updateId: string;
  observationDate: string;
  childId: string;
  childFirstName: string;
  settingName: string;
  revision: { id: string; number: number; text: string; generated: boolean };
  notes: { category: ObservationCategory; text: string }[];
  evaluation: { id: string; decision: string; results: RuleResult[] };
  review: { verdict: string; reason: string } | null;
  approval: { id: string } | null;
};

export type PublishedUpdate = {
  id: string;
  child_id: string;
  observation_date: string;
  text: string;
  published_at: string;
};
