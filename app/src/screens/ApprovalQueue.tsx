// app/src/screens/ApprovalQueue.tsx
//
// Checked drafts waiting for an approver, across every setting they
// approve for. Approving and sending are separate steps, so a person
// confirms twice before anything reaches a family.

import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { FamilyPreview } from "../components/FamilyPreview";
import type { QueueItem } from "../types";
import {
  Body,
  Button,
  ButtonRow,
  formatDay,
  Heading,
  Loading,
  Notice,
  Screen,
  Section,
  Small,
  Title,
} from "../ui";

export function ApprovalQueue() {
  const { api } = useAuth();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "good" | "problem";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!api) {
      return;
    }

    const queue = await api.get<{ items: QueueItem[] }>("/approval-queue");
    setItems(queue.items);
  }, [api]);

  useEffect(() => {
    load().catch((error) =>
      setMessage({
        tone: "problem",
        text: error instanceof ApiError ? error.message : "Couldn't load approvals.",
      })
    );
  }, [load]);

  async function act(item: QueueItem) {
    if (!api) {
      return;
    }

    setBusy(item.updateId);
    setMessage(null);

    try {
      if (item.approval) {
        await api.post(`/revision-approvals/${item.approval.id}/publication`);
        setMessage({
          tone: "good",
          text: `Sent ${item.childFirstName}'s update to the family.`,
        });
      } else {
        await api.post(`/evaluation-runs/${item.evaluation.id}/approval`);
        setMessage({
          tone: "good",
          text: `Approved ${item.childFirstName}'s update. Send it when you're ready.`,
        });
      }
    } catch (error) {
      setMessage({
        tone: "problem",
        text:
          error instanceof ApiError
            ? `${item.childFirstName}: ${error.message}`
            : "Something went wrong. Try again.",
      });
    } finally {
      setBusy(null);
      await load().catch(() => {});
    }
  }

  return (
    <Screen>
      <Title>Waiting for approval</Title>
      <Body muted>Read the family update beside the notes it came from. Approval and sending stay separate.</Body>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Body muted>
          Nothing is waiting. Drafts appear here once every check has
          passed.
        </Body>
      ) : (
        items.map((item) => (
          <Section key={item.updateId}>
            <View style={{ gap: 2 }}>
              <Small>{item.settingName.toUpperCase()}</Small>
              <Heading>{item.childFirstName}</Heading>
              <Body muted>{formatDay(item.observationDate)}</Body>
            </View>
            <View style={{ gap: 10 }}>
              <Small>SOURCE NOTES</Small>
              {item.notes.map((note, index) => (
                <View key={index} style={{ padding: 12, borderRadius: 12, backgroundColor: "#EFEFFC" }}><Body>{note.text}</Body></View>
              ))}
            </View>
            <FamilyPreview text={item.revision.text} noteCount={item.notes.length} generated={item.revision.generated} version={item.revision.number} />
            {item.review?.reason ? (
              <Small>Claude's review: {item.review.reason}</Small>
            ) : null}
            <ButtonRow>
              <Button
                label={item.approval ? "Send to family" : "Approve"}
                onPress={() => act(item)}
                busy={busy === item.updateId}
                disabled={busy !== null && busy !== item.updateId}
              />
            </ButtonRow>
            {item.approval ? <Notice tone="attention">Approved. The family cannot see it until you choose Send to family.</Notice> : <Small>Your approval confirms that a person has read this exact version.</Small>}
          </Section>
        ))
      )}
    </Screen>
  );
}
