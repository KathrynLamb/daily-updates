// app/App.tsx
//
// The app's root: loads the typeface, handles login, and shows the
// right screen for the logged-in person.

import { useState } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import { AuthProvider, useAuth } from "./src/auth";
import type { Route } from "./src/navigation";
import { ApprovalQueue } from "./src/screens/ApprovalQueue";
import { ChildDay } from "./src/screens/ChildDay";
import { Home } from "./src/screens/Home";
import { NotLinked } from "./src/screens/NotLinked";
import { ParentFeed } from "./src/screens/ParentFeed";
import { SignIn } from "./src/screens/SignIn";
import { BackContext, colours, Loading } from "./src/ui";

export default function App() {
  const [fontsLoaded] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colours.page }}>
      <StatusBar style="dark" />
      {fontsLoaded ? (
        <AuthProvider>
          <Main />
        </AuthProvider>
      ) : (
        <Loading />
      )}
    </View>
  );
}

function Main() {
  const { state } = useAuth();
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);

  if (state.status === "not_linked") {
    return <NotLinked subject={state.subject} />;
  }

  if (state.status !== "ready") {
    return <SignIn />;
  }

  const route = stack[stack.length - 1];
  const go = (next: Route) => setStack([...stack, next]);
  const back = () => setStack(stack.slice(0, -1));

  return (
    <BackContext.Provider value={stack.length > 1 ? back : null}>
      {route.name === "home" ? <Home go={go} /> : null}
      {route.name === "child" ? (
        <ChildDay child={route.child} membership={route.membership} />
      ) : null}
      {route.name === "queue" ? <ApprovalQueue /> : null}
      {route.name === "feed" ? <ParentFeed child={route.child} /> : null}
    </BackContext.Provider>
  );
}
