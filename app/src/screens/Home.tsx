import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "../auth";
import { ChildStatusCard } from "../components/ChildStatusCard";
import type { Route } from "../navigation";
import type { ChildSummary, Observation, QueueItem, StaffMembership, StaffUpdate, UpdateStatus } from "../types";
import { Body, Button, ButtonRow, colours, fonts, formatDay, Heading, Loading, Notice, Screen, Section, Small, Title, todayIso } from "../ui";

type ChildToday = ChildSummary & { noteCount: number; status: UpdateStatus | "no_notes" | "notes" };

export function Home({ go }: { go: (route: Route) => void }) {
  const { me, api, logOut } = useAuth();
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [children, setChildren] = useState<Record<string, ChildToday[]>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const canApprove = Boolean(me?.staff.some((membership) => membership.capabilities.includes("approval:create")));
  const allChildren = Object.values(children).flat();
  const capturedCount = allChildren.filter((child) => child.noteCount > 0).length;
  const sentCount = allChildren.filter((child) => child.status === "published").length;

  useEffect(() => {
    if (!api || !me) return;
    let active = true;
    const today = todayIso();
    Promise.all([
      canApprove ? api.get<{ items: QueueItem[] }>("/approval-queue") : Promise.resolve({ items: [] }),
      Promise.all(me.staff.map(async (membership) => {
        const summaries = await Promise.all(membership.children.map(async (child): Promise<ChildToday> => {
          const [observations, updates] = await Promise.all([
            api.get<{ observations: Observation[] }>(`/children/${child.id}/observations`),
            api.get<{ updates: StaffUpdate[] }>(`/children/${child.id}/updates`),
          ]);
          const noteCount = observations.observations.filter((note) => note.observation_date === today).length;
          const update = updates.updates.find((item) => item.observationDate === today);
          return { ...child, noteCount, status: update?.status ?? (noteCount ? "notes" : "no_notes") };
        }));
        return [membership.settingId, summaries] as const;
      })),
    ]).then(([queue, settings]) => {
      if (!active) return;
      setQueueCount(queue.items.length);
      setChildren(Object.fromEntries(settings));
    }).catch(() => active && setProblem("Today’s overview couldn’t be loaded. You can still open each child below."));
    return () => { active = false; };
  }, [api, me, canApprove]);

  if (!me) return null;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Small>{formatDay(todayIso()).toUpperCase()} · DAILY UPDATES</Small>
          <Title>Good morning</Title>
          <Body muted>Notice the moments that show families their child was truly seen.</Body>
        </View>
        <Button label="Log out" variant="quiet" onPress={logOut} />
      </View>
      {problem ? <Notice tone="attention">{problem}</Notice> : null}
      {allChildren.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <TodayStat value={String(allChildren.length)} label="children today" />
          <TodayStat value={String(capturedCount)} label="with a moment" />
          <TodayStat value={String(sentCount)} label="sent to family" />
        </View>
      ) : null}
      {canApprove ? (
        <Section>
          <Small>APPROVALS</Small>
          <Heading>{queueCount === null ? "Checking what’s waiting…" : queueCount === 0 ? "You’re all caught up" : `${queueCount} ${queueCount === 1 ? "update" : "updates"} waiting`}</Heading>
          <Body muted>{queueCount === 0 ? "Nothing needs your attention right now." : "Review each update beside the notes it was created from."}</Body>
          <ButtonRow><Button label="Open approvals" onPress={() => go({ name: "queue" })} disabled={queueCount === 0} /></ButtonRow>
        </Section>
      ) : null}
      {me.staff.map((membership) => (
        <SettingToday key={membership.settingId} membership={membership} children={children[membership.settingId]} onOpen={(child) => go({ name: "child", child, membership })} />
      ))}
      {me.parentOf.length ? (
        <Section>
          <Small>FOR YOUR FAMILY</Small><Heading>Your child’s days</Heading>
          <Body muted>See the updates that have been checked and sent to you.</Body>
          <ButtonRow>{me.parentOf.map((child) => <Button key={child.id} label={`Open ${child.firstName}’s journal`} variant="secondary" onPress={() => go({ name: "feed", child })} />)}</ButtonRow>
        </Section>
      ) : null}
    </Screen>
  );
}

function SettingToday({ membership, children, onOpen }: { membership: StaffMembership; children?: ChildToday[]; onOpen: (child: ChildSummary) => void }) {
  const ready = useMemo(() => children?.filter((child) => child.noteCount > 0 && child.status !== "published").length ?? 0, [children]);
  return (
    <Section>
      <View style={{ gap: 3 }}><Small>{membership.settingName.toUpperCase()}</Small><Heading>Today’s children</Heading>{children ? <Body muted>{ready ? `${ready} ${ready === 1 ? "update is" : "updates are"} ready to continue.` : "Capture a moment whenever something feels worth sharing."}</Body> : null}</View>
      {!children ? <Loading /> : children.length === 0 ? <Body muted>No children are registered here yet.</Body> : children.map((child) => (
        <ChildStatusCard key={child.id} name={child.firstName} noteCount={child.noteCount} status={child.status} onPress={() => onOpen(child)} />
      ))}
    </Section>
  );
}

function TodayStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: 140, padding: 16, borderRadius: 16, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 26, color: colours.ink }}>{value}</Text>
      <Small>{label}</Small>
    </View>
  );
}
