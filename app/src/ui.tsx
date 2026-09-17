// app/src/ui.tsx
//
// The app's visual language: colours, type and the few shared pieces
// every screen uses. Anything Claude wrote sits on the pale sky panel,
// so staff can always tell AI output from their own notes.

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

export const colours = {
  page: "#F6FAF8",
  surface: "#FFFFFF",
  ink: "#1E2A36",
  muted: "#5B6B78",
  line: "#D5E0DB",
  leaf: "#2E7D5B",
  leafSoft: "#E1F1E9",
  marigold: "#E9A23B",
  marigoldSoft: "#FCF0DC",
  marigoldInk: "#7A4E0B",
  berry: "#B23A64",
  berrySoft: "#F8E3EB",
  sky: "#E3F0F6",
  skyLine: "#B9D6E4",
};

export const fonts = {
  regular: "AtkinsonHyperlegible_400Regular",
  bold: "AtkinsonHyperlegible_700Bold",
};

// Pressable with a visible keyboard focus ring. This React Native
// version does not pass focus state to Pressable's style callback.
function FocusPressable({
  style,
  ...props
}: Omit<PressableProps, "style"> & {
  style: (state: { pressed: boolean; focused: boolean }) => StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      {...props}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={({ pressed }) => style({ pressed, focused })}
    />
  );
}

// Screens below the home screen get a Back button at the top of the page.
export const BackContext = createContext<(() => void) | null>(null);

export function Screen({ children }: { children: ReactNode }) {
  const back = useContext(BackContext);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.column}>
        {back ? (
          <View style={styles.backRow}>
            <Button label="Back" variant="quiet" onPress={back} />
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <Text style={[styles.body, muted && styles.muted]}>{children}</Text>
  );
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={styles.small}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  busy?: boolean;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: ButtonProps) {
  const inactive = disabled || busy;

  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed, focused }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "quiet" && styles.buttonQuiet,
        pressed && styles.buttonPressed,
        focused && styles.focusRing,
        inactive && styles.buttonInactive,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === "primary" ? colours.surface : colours.leaf}
        />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === "primary" && styles.buttonLabelPrimary,
          ]}
        >
          {label}
        </Text>
      )}
    </FocusPressable>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

export function Section({ children }: { children: ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

// Everything Claude wrote or judged appears on this panel.
export function ClaudePanel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.claudePanel}>
      <Text style={styles.claudeLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "good" | "attention" | "problem";
  children: ReactNode;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.notice,
        tone === "good" && styles.noticeGood,
        tone === "attention" && styles.noticeAttention,
        tone === "problem" && styles.noticeProblem,
      ]}
    >
      <Text
        style={[
          styles.body,
          tone === "attention" && { color: colours.marigoldInk },
          tone === "problem" && { color: colours.berry },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colours.muted}
        style={[styles.input, rest.multiline && styles.inputMultiline, style]}
        {...rest}
      />
    </View>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceRow} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <FocusPressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ focused }) => [
                styles.choice,
                selected && styles.choiceSelected,
                focused && styles.focusRing,
              ]}
            >
              <Text
                style={[
                  styles.choiceLabel,
                  selected && styles.choiceLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </FocusPressable>
          );
        })}
      </View>
    </View>
  );
}

export type RailState = {
  reached: number;
  tone: "good" | "attention" | "problem";
};

const railSteps = ["Notes", "Draft", "Checked", "Approved", "Published"];

// Where today's update is in its journey to parents. The last step
// reached takes the tone of its outcome.
export function ProgressRail({ reached, tone }: RailState) {
  const current = colours[
    tone === "good" ? "leaf" : tone === "attention" ? "marigold" : "berry"
  ];

  return (
    <View
      style={styles.rail}
      accessible
      accessibilityLabel={
        reached < 0
          ? "No notes yet"
          : `Reached: ${railSteps[reached]}` +
            (tone === "good" ? "" : ", needs attention")
      }
    >
      {railSteps.map((step, index) => {
        const done = index <= reached;
        const isCurrent = index === reached;
        const dotColour = isCurrent ? current : done ? colours.leaf : colours.line;

        return (
          <View key={step} style={styles.railStep}>
            <View style={styles.railTrack}>
              <View
                style={[
                  styles.railLine,
                  index === 0 && styles.railLineHidden,
                  { backgroundColor: done ? colours.leaf : colours.line },
                ]}
              />
              <View
                style={[
                  styles.railDot,
                  { backgroundColor: done ? dotColour : colours.surface },
                  { borderColor: dotColour },
                ]}
              />
              <View
                style={[
                  styles.railLine,
                  index === railSteps.length - 1 && styles.railLineHidden,
                  {
                    backgroundColor:
                      index < reached ? colours.leaf : colours.line,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.railLabel,
                done && styles.railLabelDone,
                isCurrent && { color: current },
              ]}
            >
              {step}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colours.leaf} />
    </View>
  );
}

export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function todayIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  pageContent: { paddingHorizontal: 20, paddingVertical: 28 },
  column: { width: "100%", maxWidth: 720, alignSelf: "center", gap: 20 },
  title: {
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 38,
    color: colours.ink,
    letterSpacing: -0.4,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 21,
    lineHeight: 28,
    color: colours.ink,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 26,
    color: colours.ink,
  },
  muted: { color: colours.muted },
  small: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colours.muted,
  },
  button: {
    alignSelf: "flex-start",
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  buttonPrimary: { backgroundColor: colours.leaf },
  buttonSecondary: {
    backgroundColor: colours.surface,
    borderColor: colours.leaf,
  },
  buttonQuiet: { backgroundColor: "transparent", paddingHorizontal: 8 },
  backRow: { marginLeft: -8, marginBottom: -12 },
  buttonPressed: { opacity: 0.8 },
  buttonInactive: { opacity: 0.45 },
  buttonLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colours.leaf,
  },
  buttonLabelPrimary: { color: colours.surface },
  focusRing: {
    borderColor: colours.ink,
    borderStyle: "solid",
  },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  section: {
    backgroundColor: colours.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.line,
    padding: 20,
    gap: 14,
  },
  claudePanel: {
    backgroundColor: colours.sky,
    borderLeftWidth: 4,
    borderLeftColor: colours.skyLine,
    borderRadius: 8,
    padding: 16,
    gap: 8,
  },
  claudeLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colours.muted,
  },
  notice: { borderRadius: 10, padding: 14 },
  noticeGood: { backgroundColor: colours.leafSoft },
  noticeAttention: { backgroundColor: colours.marigoldSoft },
  noticeProblem: { backgroundColor: colours.berrySoft },
  field: { gap: 6 },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 15, color: colours.ink },
  input: {
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colours.ink,
    backgroundColor: colours.surface,
    borderWidth: 2,
    borderColor: colours.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: "top" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colours.line,
    backgroundColor: colours.surface,
  },
  choiceSelected: {
    borderColor: colours.leaf,
    backgroundColor: colours.leafSoft,
  },
  choiceLabel: { fontFamily: fonts.regular, fontSize: 15, color: colours.ink },
  choiceLabelSelected: { fontFamily: fonts.bold, color: colours.leaf },
  rail: { flexDirection: "row", paddingVertical: 4 },
  railStep: { flex: 1, alignItems: "center", gap: 6 },
  railTrack: { flexDirection: "row", alignItems: "center", width: "100%" },
  railLine: { flex: 1, height: 3 },
  railLineHidden: { opacity: 0 },
  railDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  railLabel: { fontFamily: fonts.regular, fontSize: 13, color: colours.muted },
  railLabelDone: { color: colours.ink },
  loading: { paddingVertical: 40, alignItems: "center" },
});
