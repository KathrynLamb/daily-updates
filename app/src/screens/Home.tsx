// app/src/screens/Home.tsx
//
// Where each person starts: the children they work with, the approval
// queue if they can approve, and their own children if they are a
// parent.

import { useEffect, useState } from "react";
import { View } from "react-native";
import { useAuth } from "../auth";
import type { ChildSummary, QueueItem, StaffMembership } from "../types";
import { Body, Button, ButtonRow, Heading, Screen, Section, Small, Title } from "../ui";
import type { Route } from "../navigation";

const roleNames: Record<string, string> = {
  practitioner: "Practitioner",
  approver: "Approver",
  admin: "Admin",
};

export function Home({ go }: { go: (route: Route) => void }) {
  const { me, api, logOut } = useAuth();
  const [queueCount, setQueueCount] = useState<number | null>(null);

  const canApprove = Boolean(
    me?.staff.some((membership) =>
      membership.capabilities.includes("approval:create")
    )
  );

  useEffect(() => {
    if (!api || !canApprove) {
      return;
    }

    api
      .get<{ items: QueueItem[] }>("/approval-queue")
      .then((queue) => setQueueCount(queue.items.length))
      .catch(() => setQueueCount(null));
  }, [api, canApprove]);

  if (!me) {
    return null;
  }

  const nothing = me.staff.length === 0 && me.parentOf.length === 0;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Title>Daily Updates</Title>
        <Button label="Log out" variant="quiet" onPress={logOut} />
      </View>

      {canApprove ? (
        <Section>
          <Heading>Waiting for approval</Heading>
          <Body muted>
            {queueCount === null
              ? "Checked drafts ready for you to approve and send."
              : queueCount === 0
                ? "Nothing is waiting right now."
                : `${queueCount} ${queueCount === 1 ? "update is" : "updates are"} ready for you to approve and send.`}
          </Body>
          <ButtonRow>
            <Button label="Open approvals" onPress={() => go({ name: "queue" })} />
          </ButtonRow>
        </Section>
      ) : null}

      {me.staff.map((membership) => (
        <SettingChildren key={membership.settingId} membership={membership} go={go} />
      ))}

      {me.parentOf.length > 0 ? (
        <Section>
          <Heading>Your child's updates</Heading>
          {me.parentOf.map((child) => (
            <ChildButton
              key={child.id}
              child={child}
              onPress={() => go({ name: "feed", child })}
            />
          ))}
        </Section>
      ) : null}

      {nothing ? (
        <Body>This account can't see any children yet.</Body>
      ) : null}
    </Screen>
  );
}

function SettingChildren({
  membership,
  go,
}: {
  membership: StaffMembership;
  go: (route: Route) => void;
}) {
  return (
    <Section>
      <Heading>{membership.settingName}</Heading>
      <Small>You're signed in here as {roleNames[membership.role] ?? membership.role}.</Small>
      {membership.children.length === 0 ? (
        <Body muted>No children are registered at this setting yet.</Body>
      ) : (
        membership.children.map((child) => (
          <ChildButton
            key={child.id}
            child={child}
            onPress={() => go({ name: "child", child, membership })}
          />
        ))
      )}
    </Section>
  );
}

function ChildButton({
  child,
  onPress,
}: {
  child: ChildSummary;
  onPress: () => void;
}) {
  return <Button label={child.firstName} variant="secondary" onPress={onPress} />;
}
