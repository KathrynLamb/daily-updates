import { View } from "react-native";
import type { Observation } from "../types";
import { Body, colours, fonts, Small } from "../ui";

const categoryDetails = {
  activity: { label: "Play and discovery", symbol: "✦", tint: colours.lavender },
  food: { label: "From an earlier care note", symbol: "●", tint: colours.blush },
  sleep: { label: "From an earlier care note", symbol: "☾", tint: colours.sky },
  general: { label: "Words, connection or another moment", symbol: "•", tint: colours.marigoldSoft },
} as const;

export function ObservationCard({ observation }: { observation: Observation }) {
  const category = categoryDetails[observation.category];

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: category.tint,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colours.surface,
        }}
      >
        <Body>{category.symbol}</Body>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Small>{category.label}</Small>
        <Body>{observation.text}</Body>
      </View>
    </View>
  );
}
