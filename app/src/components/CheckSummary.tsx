import { useState } from "react";
import { Text, View } from "react-native";
import type { RuleResult, StaffUpdate } from "../types";
import { Body, Button, colours, fonts, Notice, Section, Small } from "../ui";

const ruleNames: Record<string, string> = {
  text_length: "Is it a comfortable length?",
  source_presence: "Is it based on your moments?",
  source_freshness: "Does it use the latest moments?",
  content_grounding: "Does it only say what you observed?",
  content_coverage: "Does it include every selected moment?",
};

export function CheckSummary({ update }: { update: StaffUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const evaluation = update.evaluation;

  if (!evaluation || evaluation.status !== "completed") return null;

  const passed = evaluation.results.filter((result) => result.outcome === "pass").length;
  const eligible = evaluation.decision === "eligible";
  const blocked = evaluation.decision === "blocked";

  return (
    <Section>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 20, color: colours.ink }}>
          {eligible ? "Ready for approval" : blocked ? "This draft needs changes" : "A person needs to review this"}
        </Text>
        <Body muted>{passed} of {evaluation.results.length} checks passed.</Body>
      </View>
      <Notice tone={eligible ? "good" : blocked ? "problem" : "attention"}>
        {eligible
          ? "The wording is supported by your original moments. A person still makes the final decision."
          : "Edit the draft or create another version before continuing."}
      </Notice>
      <Button
        label={expanded ? "Hide check details" : "View check details"}
        variant="quiet"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <View style={{ gap: 12 }}>
          {evaluation.results.map((result) => <RuleLine key={result.ruleId} result={result} />)}
        </View>
      ) : null}
    </Section>
  );
}

function RuleLine({ result }: { result: RuleResult }) {
  const passed = result.outcome === "pass";
  const colour = passed ? colours.leaf : result.outcome === "fail" ? colours.berry : colours.marigoldInk;
  return (
    <View style={{ gap: 2, borderLeftWidth: 3, borderLeftColor: colour, paddingLeft: 12 }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colours.ink }}>
        {ruleNames[result.ruleId] ?? result.ruleId} · <Text style={{ color: colour }}>{passed ? "Passed" : "Needs attention"}</Text>
      </Text>
      {passed ? null : <Small>{result.reason}</Small>}
    </View>
  );
}
