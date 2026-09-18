import { Pressable, Text, View } from "react-native";
import type { UpdateStatus } from "../types";
import { colours, fonts, Small } from "../ui";

const statusCopy: Record<UpdateStatus | "no_notes" | "notes", string> = {
  no_notes: "No moment yet",
  notes: "Ready to shape",
  draft: "Ready to check",
  reviewed: "Finish checking",
  evaluating: "Checking draft",
  evaluation_failed: "Check again",
  blocked: "Needs changes",
  needs_review: "Needs a person",
  ready_for_approval: "Ready for approval",
  approved: "Ready to send",
  published: "Sent to family",
};

export function ChildStatusCard({
  name,
  noteCount,
  status,
  onPress,
}: {
  name: string;
  noteCount: number;
  status: UpdateStatus | "no_notes" | "notes";
  onPress: () => void;
}) {
  const attention = ["blocked", "needs_review", "evaluation_failed"].includes(status);
  const complete = status === "published";
  const tint = attention ? colours.berrySoft : complete ? colours.leafSoft : colours.lavender;
  const action = status === "no_notes" ? "Add moment" : complete ? "View" : "Continue";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${statusCopy[status]}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colours.line,
        backgroundColor: pressed ? colours.blush : colours.surface,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tint,
        }}
      >
        <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colours.ink }}>{name.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colours.ink }}>{name}</Text>
        <Small>{noteCount === 0 ? "Nothing captured today" : `${noteCount} ${noteCount === 1 ? "moment" : "moments"} today`}</Small>
      </View>
      <View style={{ alignItems: "flex-end", gap: 5 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: tint }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: attention ? colours.berry : colours.ink }}>
            {statusCopy[status]}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colours.coral }}>{action} →</Text>
      </View>
    </Pressable>
  );
}
