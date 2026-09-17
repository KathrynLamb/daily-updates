// app/src/screens/NotLinked.tsx
//
// Shown when someone logs in successfully but has not been given any
// access to Daily Updates yet.

import { Body, Button, ButtonRow, Heading, Screen, Section, Small, Title } from "../ui";
import { useAuth } from "../auth";
import { Platform, Text } from "react-native";

export function NotLinked({ subject }: { subject: string }) {
  const { retry, logOut } = useAuth();

  return (
    <Screen>
      <Title>You're logged in, but not set up yet</Title>
      <Body>
        This account doesn't have access to any children yet. Someone
        who runs Daily Updates needs to add it.
      </Body>
      <Section>
        <Heading>Your account ID</Heading>
        <Text
          selectable
          style={{
            fontFamily: Platform.select({ web: "monospace", default: undefined }),
            fontSize: 16,
          }}
        >
          {subject}
        </Text>
        <Small>
          On a local copy, give this account a demo role with, for
          example: npm run auth:link -- practitioner '{subject}'
        </Small>
      </Section>
      <ButtonRow>
        <Button label="Check again" onPress={retry} />
        <Button label="Log out" variant="secondary" onPress={logOut} />
      </ButtonRow>
    </Screen>
  );
}
