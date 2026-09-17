// app/src/screens/ChildDay.tsx
//
// One child's day for staff: the notes, Claude's draft, the checks,
// and, for approvers, approving and sending it to the family.

import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import type {
  ChildSummary,
  Observation,
  ObservationCategory,
  RuleResult,
  StaffMembership,
  StaffUpdate,
} from "../types";
import {
  Body,
  Button,
  ButtonRow,
  Choice,
  ClaudePanel,
  colours,
  Field,
  fonts,
  formatDay,
  Heading,
  Loading,
  Notice,
  ProgressRail,
  Screen,
  Section,
  shiftIso,
  Small,
  Title,
  todayIso,
  type RailState,
} from "../ui";

const categories: { value: ObservationCategory; label: string }[] = [
  { value: "activity", label: "Activity" },
  { value: "food", label: "Food" },
  { value: "sleep", label: "Sleep" },
  { value: "general", label: "Other" },
];

const ruleNames: Record<string, string> = {
  text_length: "Length",
  source_presence: "Based on notes",
  source_freshness: "Notes unchanged",
  content_grounding: "Only what was observed",
  content_coverage: "Covers every note",
};

function railFor(notes: number, update: StaffUpdate | undefined): RailState {
  if (!update) {
    return { reached: notes > 0 ? 0 : -1, tone: "good" };
  }

  switch (update.status) {
    case "published":
      return { reached: 4, tone: "good" };
    case "approved":
      return { reached: 3, tone: "good" };
    case "ready_for_approval":
      return { reached: 2, tone: "good" };
    case "needs_review":
    case "evaluation_failed":
      return { reached: 2, tone: "attention" };
    case "blocked":
      return { reached: 2, tone: "problem" };
    default:
      return { reached: 1, tone: "good" };
  }
}

export function ChildDay({
  child,
  membership,
}: {
  child: ChildSummary;
  membership: StaffMembership;
}) {
  const { api } = useAuth();
  const canApprove = membership.capabilities.includes("approval:create");

  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState<Observation[] | null>(null);
  const [update, setUpdate] = useState<StaffUpdate | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "good" | "attention" | "problem";
    text: string;
  } | null>(null);

  const [category, setCategory] = useState<ObservationCategory>("activity");
  const [noteText, setNoteText] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");

  const load = useCallback(async () => {
    if (!api) {
      return;
    }

    const [observations, updates] = await Promise.all([
      api.get<{ observations: Observation[] }>(
        `/children/${child.id}/observations`
      ),
      api.get<{ updates: StaffUpdate[] }>(`/children/${child.id}/updates`),
    ]);

    setNotes(
      observations.observations
        .filter((note) => note.observation_date === date)
        .reverse()
    );
    setUpdate(updates.updates.find((item) => item.observationDate === date));
  }, [api, child.id, date]);

  useEffect(() => {
    setNotes(null);
    setMessage(null);
    setEditing(false);
    load().catch((error) =>
      setMessage({ tone: "problem", text: errorText(error) })
    );
  }, [load]);

  // Runs an action, shows what happened, and reloads the day.
  async function run(
    name: string,
    action: () => Promise<unknown>,
    done?: string
  ) {
    setBusy(name);
    setMessage(null);

    try {
      await action();
      await load();

      if (done) {
        setMessage({ tone: "good", text: done });
      }
    } catch (error) {
      setMessage({ tone: "problem", text: errorText(error) });
      await load().catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  if (!api) {
    return null;
  }

  const hasNotes = (notes?.length ?? 0) > 0;
  const rail = railFor(notes?.length ?? 0, update);

  const addNote = () =>
    run(
      "note",
      async () => {
        await api.post("/observations", {
          childId: child.id,
          observationDate: date,
          category,
          text: noteText.trim(),
        });
        setNoteText("");
      },
      update ? "Note added. Rewrite or edit the draft to include it." : undefined
    );

  const writeDraft = () =>
    run("write", () =>
      update
        ? api.post(`/updates/${update.id}/generations`, {
            expectedRevision: update.revision.number,
          })
        : api.post("/drafts/generate", {
            childId: child.id,
            observationDate: date,
          })
    );

  const saveEdit = () =>
    run(
      "save",
      async () => {
        if (!update) {
          return;
        }

        await api.post(`/updates/${update.id}/revisions`, {
          expectedRevision: update.revision.number,
          text: draftText.trim(),
          refreshSources: true,
        });
        setEditing(false);
      },
      "Edits saved. Check the draft again before it can be approved."
    );

  // A draft is checked in two steps: Claude's review, then the rules.
  const checkDraft = () =>
    run("check", async () => {
      if (!update) {
        return;
      }

      await api.post(`/revisions/${update.revision.id}/content-reviews`);
      await api.post(`/revisions/${update.revision.id}/evaluations`);
    });

  const approve = () =>
    run(
      "approve",
      () => api.post(`/evaluation-runs/${update?.evaluation?.id}/approval`),
      "Approved."
    );

  const publish = () =>
    run(
      "publish",
      () => api.post(`/revision-approvals/${update?.approval?.id}/publication`),
      `Sent to ${child.firstName}'s family.`
    );

  // Only unchecked drafts can be checked. A draft that failed its checks
  // must be changed first: checking the same words again until Claude
  // happens to pass them would defeat the point of checking.
  const checkable =
    update &&
    ["draft", "reviewed", "evaluation_failed"].includes(update.status);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Title>{child.firstName}</Title>
        <Body muted>{membership.settingName}</Body>
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Heading>{formatDay(date)}</Heading>
          <ButtonRow>
            <Button label="Previous day" variant="quiet" onPress={() => setDate(shiftIso(date, -1))} />
            {date !== todayIso() ? (
              <Button label="Today" variant="quiet" onPress={() => setDate(todayIso())} />
            ) : null}
            <Button label="Next day" variant="quiet" onPress={() => setDate(shiftIso(date, 1))} />
          </ButtonRow>
        </View>
        <ProgressRail {...rail} />
      </View>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {notes === null ? (
        <Loading />
      ) : (
        <>
          <Section>
            <Heading>Notes</Heading>
            {notes.length === 0 ? (
              <Body muted>No notes for this day yet. Add the first one below.</Body>
            ) : (
              notes.map((note) => (
                <View key={note.id} style={{ gap: 2 }}>
                  <Small>{categories.find((item) => item.value === note.category)?.label}</Small>
                  <Body>{note.text}</Body>
                </View>
              ))
            )}
            <Choice label="Type" options={categories} value={category} onChange={setCategory} />
            <Field
              label="What happened"
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Built a tower with wooden blocks."
              multiline
            />
            <ButtonRow>
              <Button
                label="Add note"
                variant="secondary"
                onPress={addNote}
                disabled={noteText.trim().length === 0}
                busy={busy === "note"}
              />
            </ButtonRow>
          </Section>

          <Section>
            <Heading>Update for the family</Heading>

            {!update ? (
              <>
                <Body muted>
                  {hasNotes
                    ? `Claude will write a short update from these notes for you to check.`
                    : "Add at least one note, then Claude can write the update."}
                </Body>
                <ButtonRow>
                  <Button label="Write draft" onPress={writeDraft} disabled={!hasNotes} busy={busy === "write"} />
                </ButtonRow>
              </>
            ) : editing ? (
              <>
                <Field label="Draft" value={draftText} onChangeText={setDraftText} multiline />
                <ButtonRow>
                  <Button label="Save edits" onPress={saveEdit} disabled={draftText.trim().length === 0} busy={busy === "save"} />
                  <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} />
                </ButtonRow>
              </>
            ) : (
              <>
                {update.revision.generated ? (
                  <ClaudePanel label={`Written by Claude, version ${update.revision.number}`}>
                    <Body>{update.revision.text}</Body>
                  </ClaudePanel>
                ) : (
                  <View style={{ gap: 4 }}>
                    <Small>Edited by staff, version {update.revision.number}</Small>
                    <Body>{update.revision.text}</Body>
                  </View>
                )}

                {update.status === "published" ? (
                  <Notice tone="good">Sent to {child.firstName}'s family.</Notice>
                ) : null}
                {update.publication && update.status !== "published" ? (
                  <Small>An earlier version was already sent. This newer version hasn't been.</Small>
                ) : null}

                <ButtonRow>
                  {checkable ? (
                    <Button label="Check draft" onPress={checkDraft} busy={busy === "check"} />
                  ) : null}
                  {canApprove && update.status === "ready_for_approval" ? (
                    <Button label="Approve" onPress={approve} busy={busy === "approve"} />
                  ) : null}
                  {canApprove && update.status === "approved" ? (
                    <Button label="Send to family" onPress={publish} busy={busy === "publish"} />
                  ) : null}
                  <Button
                    label="Edit"
                    variant="secondary"
                    onPress={() => {
                      setDraftText(update.revision.text);
                      setEditing(true);
                    }}
                  />
                  <Button label="Rewrite with Claude" variant="secondary" onPress={writeDraft} busy={busy === "write"} />
                </ButtonRow>

                {update.status === "ready_for_approval" && !canApprove ? (
                  <Small>Checked and ready. An approver will review and send it.</Small>
                ) : null}
              </>
            )}
          </Section>

          {update && !editing ? <CheckResults update={update} /> : null}
        </>
      )}
    </Screen>
  );
}

function CheckResults({ update }: { update: StaffUpdate }) {
  const evaluation = update.evaluation;

  if (!evaluation || evaluation.status !== "completed") {
    if (update.review?.status === "completed") {
      return (
        <Section>
          <Heading>Checks</Heading>
          <Body muted>Claude has reviewed the draft. Press Check draft to finish the checks.</Body>
        </Section>
      );
    }

    return null;
  }

  const summary =
    evaluation.decision === "eligible"
      ? { tone: "good" as const, text: "Every check passed. This version can be approved." }
      : evaluation.decision === "blocked"
        ? { tone: "problem" as const, text: "This version can't be sent as written. Edit it or rewrite it, then check again." }
        : { tone: "attention" as const, text: "A person needs to look at this before it can be approved. Edit it or rewrite it, then check again." };

  return (
    <Section>
      <Heading>Checks</Heading>
      <Notice tone={summary.tone}>{summary.text}</Notice>
      {evaluation.results.map((result) => (
        <RuleLine key={result.ruleId} result={result} />
      ))}
    </Section>
  );
}

function RuleLine({ result }: { result: RuleResult }) {
  const passed = result.outcome === "pass";
  const colour =
    result.outcome === "pass"
      ? colours.leaf
      : result.outcome === "fail"
        ? colours.berry
        : colours.marigoldInk;
  const word =
    result.outcome === "pass"
      ? "Passed"
      : result.outcome === "fail"
        ? "Failed"
        : result.outcome === "review"
          ? "Needs a person"
          : "Couldn't check";

  return (
    <View style={{ gap: 2, borderLeftWidth: 3, borderLeftColor: colour, paddingLeft: 12 }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colours.ink }}>
        {ruleNames[result.ruleId] ?? result.ruleId}{" "}
        <Text style={{ color: colour }}>{word}</Text>
      </Text>
      {passed ? null : <Small>{result.reason}</Small>}
    </View>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return `${error.message} The page has been refreshed.`;
    }

    return error.message;
  }

  return "Something went wrong. Try again.";
}
