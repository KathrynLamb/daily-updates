// app/src/screens/SignIn.tsx
//
// A shared front door for practitioners, approvers and families. It borrows
// the warmth, bold colour and friendly geometry of modern early-years brands
// without pretending to be part of any of them.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth";
import { Body, Button, colours, fonts, Notice, Small } from "../ui";

export function SignIn() {
  const { state, canLogIn, logIn } = useAuth();

  return (
    <View style={styles.page}>
      <View style={styles.sunShape} />
      <View style={styles.mintShape} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <View style={styles.brandMark} accessible={false}>
            <View style={[styles.brandPetal, styles.brandPetalTop]} />
            <View style={[styles.brandPetal, styles.brandPetalRight]} />
            <View style={[styles.brandPetal, styles.brandPetalBottom]} />
            <View style={[styles.brandPetal, styles.brandPetalLeft]} />
          </View>
          <Text style={styles.brandName}>daily updates</Text>
        </View>

        <View style={styles.hero}>
          <Small>FOR EARLY YEARS TEAMS AND FAMILIES</Small>
          <Text style={styles.title} accessibilityRole="header">
            The little moments matter.
          </Text>
          <Body>
            Thoughtful updates that help families feel part of their child’s
            day.
          </Body>
        </View>

        <View
          style={styles.momentCard}
          accessible
          accessibilityLabel="A moment moves from noticed, to thoughtfully prepared, to safely shared"
        >
          <View style={styles.cardDecoration} />
          <Text style={styles.cardEyebrow}>A MOMENT FROM TODAY</Text>
          <Text style={styles.cardQuote}>
            “I made the tallest tower!”
          </Text>
          <View style={styles.journey}>
            <JourneyStep number="1" label="Noticed" />
            <View style={styles.journeyLine} />
            <JourneyStep number="2" label="Prepared" />
            <View style={styles.journeyLine} />
            <JourneyStep number="3" label="Shared" />
          </View>
        </View>

        <View style={styles.actions}>
          {state.status === "signed_out" && state.message ? (
            <Notice tone="attention">{state.message}</Notice>
          ) : null}
          {state.status === "failed" ? (
            <Notice tone="problem">{state.message}</Notice>
          ) : null}
          <Button
            label="Sign in"
            onPress={logIn}
            disabled={!canLogIn}
            busy={state.status === "signing_in"}
            fullWidth
          />
          <View style={styles.trustRow}>
            <View style={styles.trustDot} />
            <Text style={styles.trustText}>
              Secure sign-in · Updates are reviewed before sharing
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function JourneyStep({ number, label }: { number: string; label: string }) {
  return (
    <View style={styles.journeyStep}>
      <View style={styles.journeyNumber}>
        <Text style={styles.journeyNumberText}>{number}</Text>
      </View>
      <Text style={styles.journeyLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#FFF8F1",
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 30,
    gap: 28,
  },
  sunShape: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#FFD94A",
    right: -105,
    top: -60,
  },
  mintShape: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#BDEBDD",
    left: -105,
    top: 360,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
  },
  brandPetal: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 5,
    backgroundColor: colours.coral,
  },
  brandPetalTop: { left: 10, top: 0, transform: [{ rotate: "45deg" }] },
  brandPetalRight: { right: 0, top: 10, transform: [{ rotate: "45deg" }] },
  brandPetalBottom: { left: 10, bottom: 0, transform: [{ rotate: "45deg" }] },
  brandPetalLeft: { left: 0, top: 10, transform: [{ rotate: "45deg" }] },
  brandName: {
    fontFamily: fonts.bold,
    fontSize: 21,
    color: colours.ink,
    letterSpacing: -0.3,
  },
  hero: {
    gap: 12,
    paddingTop: 8,
  },
  title: {
    maxWidth: 420,
    fontFamily: fonts.bold,
    fontSize: 46,
    lineHeight: 48,
    letterSpacing: -1.4,
    color: colours.ink,
  },
  momentCard: {
    minHeight: 210,
    padding: 22,
    paddingTop: 26,
    borderRadius: 30,
    backgroundColor: "#FF8B86",
    overflow: "hidden",
    justifyContent: "space-between",
    shadowColor: colours.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  cardDecoration: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: "#6F58C9",
    right: -42,
    top: -42,
  },
  cardEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.8,
    color: colours.ink,
  },
  cardQuote: {
    maxWidth: 300,
    fontFamily: fonts.bold,
    fontSize: 27,
    lineHeight: 33,
    color: colours.ink,
  },
  journey: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
  },
  journeyStep: {
    alignItems: "center",
    gap: 6,
  },
  journeyNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colours.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  journeyNumberText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colours.ink,
  },
  journeyLabel: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colours.ink,
  },
  journeyLine: {
    flex: 1,
    height: 2,
    marginTop: 14,
    backgroundColor: "rgba(22, 18, 61, 0.35)",
  },
  actions: {
    marginTop: "auto",
    gap: 14,
  },
  trustRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
  },
  trustDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colours.leaf,
  },
  trustText: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colours.muted,
  },
});
