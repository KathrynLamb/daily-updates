// app/src/screens/ChildDay.tsx
//
// One child's day for staff: the notes, Claude's draft, the checks,
// and, for approvers, approving and sending it to the family.

import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import type {
  ChildSummary,
  Observation,
  ObservationCategory,
  StaffMembership,
  StaffUpdate,
} from "../types";
import { CheckSummary } from "../components/CheckSummary";
import { DayNavigation } from "../components/DayNavigation";
import { FamilyPreview } from "../components/FamilyPreview";
import { ObservationCard } from "../components/ObservationCard";
import {
  Body,
  Button,
  ButtonRow,
  Choice,
  Field,
  Heading,
  Loading,
  Notice,
  Screen,
  Section,
  Small,
  Title,
  todayIso,
} from "../ui";

type MomentKind = "discovery" | "voice" | "connection" | "other";

const momentKinds: { value: MomentKind; label: string }[] = [
  { value: "discovery", label: "Tried or discovered" },
  { value: "voice", label: "Said or wondered" },
  { value: "connection", label: "Connected with someone" },
  { value: "other", label: "Something else" },
];

const categoryForMoment: Record<MomentKind, ObservationCategory> = {
  discovery: "activity",
  voice: "general",
  connection: "general",
  other: "general",
};


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

  const [momentKind, setMomentKind] = useState<MomentKind>("discovery");
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

  const addNote = () =>
    run(
      "note",
      async () => {
        await api.post("/observations", {
          childId: child.id,
          observationDate: date,
          category: categoryForMoment[momentKind],
          text: noteText.trim(),
        });
        setNoteText("");
      },
      update ? "Moment saved. Create another version to include it in the family update." : "Moment saved. You can get straight back to the children."
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
        <Small>{membership.settingName.toUpperCase()}</Small>
        <Title>{child.firstName}</Title>
        <Body muted>{hasNotes ? `${notes?.length} ${notes?.length === 1 ? "moment" : "moments"} captured. Add another in a few words, or shape the update below.` : "Capture only the detail that someone who knows them would notice."}</Body>
      </View>

      <DayNavigation date={date} onChange={setDate} />

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {notes === null ? (
        <Loading />
      ) : (
        <>
          <Section>
            <View style={{ gap: 3 }}><Small>QUICK CAPTURE</Small><Heading>What did you notice?</Heading></View>
            {notes.length === 0 ? (
              <Body muted>A short phrase is enough. Save the detail now and shape it for the family later.</Body>
            ) : (
              notes.map((note) => <ObservationCard key={note.id} observation={note} />)
            )}
            <Choice label="This moment was about…" options={momentKinds} value={momentKind} onChange={setMomentKind} />
            <Field
              label="What did you notice?"
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Ava rebuilt her tower twice, then called Mia over to see it."
              multiline
            />
            <Small>Use your own words. The original is always kept, even if you create a family-friendly version later.</Small>
            <ButtonRow>
              <Button
                label="Save moment"
                onPress={addNote}
                disabled={noteText.trim().length === 0}
                busy={busy === "note"}
              />
            </ButtonRow>
            <View style={{ paddingTop: 4 }}>
              <Notice tone="attention">This space is only for family-shareable moments. Record accidents, medication and safeguarding concerns in your setting’s required system.</Notice>
            </View>
          </Section>

          <Section>
            <View style={{ gap: 3 }}><Small>WHEN YOU HAVE A QUIET MOMENT</Small><Heading>Shape the family update</Heading></View>

            {!update ? (
              <>
                <Body muted>
                  {hasNotes
                    ? `Turn ${notes?.length} ${notes?.length === 1 ? "moment" : "moments"} into a concise update. Nothing is sent until a person reviews it.`
                    : "Add at least one moment before creating the family update."}
                </Body>
                <ButtonRow>
                  <Button label="Create family update" onPress={writeDraft} disabled={!hasNotes} busy={busy === "write"} />
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
                <FamilyPreview text={update.revision.text} noteCount={notes.length} generated={update.revision.generated} version={update.revision.number} />

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
                  <Button label="Create another version" variant="secondary" onPress={writeDraft} busy={busy === "write"} />
                </ButtonRow>

                {update.status === "ready_for_approval" && !canApprove ? (
                  <Small>Checked and ready. An approver will review and send it.</Small>
                ) : null}
              </>
            )}
          </Section>

          {update && !editing ? <CheckSummary update={update} /> : null}
        </>
      )}
    </Screen>
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
