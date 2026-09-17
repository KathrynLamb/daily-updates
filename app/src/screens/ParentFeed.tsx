// app/src/screens/ParentFeed.tsx
//
// What a family sees: the updates that were approved and sent, and
// nothing else.

import { useEffect, useState } from "react";
import { View } from "react-native";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import type { ChildSummary, PublishedUpdate } from "../types";
import {
  Body,
  colours,
  formatDay,
  Heading,
  Loading,
  Notice,
  Screen,
  Title,
} from "../ui";

export function ParentFeed({ child }: { child: ChildSummary }) {
  const { api } = useAuth();
  const [updates, setUpdates] = useState<PublishedUpdate[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api
      ?.get<{ updates: PublishedUpdate[] }>(
        `/children/${child.id}/published-updates`
      )
      .then((result) => setUpdates(result.updates))
      .catch((error) =>
        setProblem(
          error instanceof ApiError ? error.message : "Couldn't load updates."
        )
      );
  }, [api, child.id]);

  return (
    <Screen>
      <Title>{child.firstName}'s days</Title>
      {problem ? <Notice tone="problem">{problem}</Notice> : null}
      {updates === null && !problem ? (
        <Loading />
      ) : updates?.length === 0 ? (
        <Body muted>
          No updates yet. They'll appear here once the team sends them.
        </Body>
      ) : (
        updates?.map((update) => (
          <View
            key={update.id}
            style={{
              gap: 6,
              paddingBottom: 20,
              borderBottomWidth: 1,
              borderBottomColor: colours.line,
            }}
          >
            <Heading>{formatDay(update.observation_date)}</Heading>
            <Body>{update.text}</Body>
          </View>
        ))
      )}
    </Screen>
  );
}
