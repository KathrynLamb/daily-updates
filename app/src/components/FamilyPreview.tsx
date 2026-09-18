import { View } from "react-native";
import { Body, colours, Small } from "../ui";

export function FamilyPreview({
  text,
  noteCount,
  generated,
  version,
}: {
  text: string;
  noteCount: number;
  generated: boolean;
  version: number;
}) {
  return (
    <View
      style={{
        overflow: "hidden",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colours.line,
        backgroundColor: colours.surface,
      }}
    >
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colours.blush }}>
        <Small>EXACTLY WHAT THE FAMILY WILL SEE</Small>
      </View>
      <View style={{ padding: 18, gap: 12 }}>
        <Body>{text}</Body>
        <Small>
          {generated ? `Shaped from ${noteCount} original ${noteCount === 1 ? "moment" : "moments"}` : "Edited by a person"}
          {` · Version ${version}`}
        </Small>
      </View>
    </View>
  );
}
