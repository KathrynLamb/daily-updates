// app/src/screens/SignIn.tsx

import { Body, Button, Notice, Screen, Small, Title } from "../ui";
import { useAuth } from "../auth";

export function SignIn() {
  const { state, canLogIn, logIn } = useAuth();

  return (
    <Screen>
      <Title>Daily Updates</Title>
      <Body>
        Turn the day's notes into a checked, approved update for each
        child's family.
      </Body>
      {state.status === "signed_out" && state.message ? (
        <Notice tone="attention">{state.message}</Notice>
      ) : null}
      {state.status === "failed" ? (
        <Notice tone="problem">{state.message}</Notice>
      ) : null}
      <Button
        label="Log in"
        onPress={logIn}
        disabled={!canLogIn}
        busy={state.status === "signing_in"}
      />
      <Small>
        You'll sign in on Auth0's secure page, then come straight back
        here.
      </Small>
    </Screen>
  );
}
