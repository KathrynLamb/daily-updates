import { View } from "react-native";
import { Button, ButtonRow, formatDay, Heading, shiftIso, todayIso } from "../ui";

export function DayNavigation({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Heading>{formatDay(date)}</Heading>
      <ButtonRow>
        <Button label="← Previous" variant="quiet" onPress={() => onChange(shiftIso(date, -1))} />
        {date !== todayIso() ? (
          <Button label="Today" variant="secondary" onPress={() => onChange(todayIso())} />
        ) : null}
        <Button label="Next →" variant="quiet" onPress={() => onChange(shiftIso(date, 1))} />
      </ButtonRow>
    </View>
  );
}
