// app/src/navigation.ts
//
// The app has only a few screens, so navigation is a simple stack kept
// in state rather than a routing library.

import type { ChildSummary, StaffMembership } from "./types";

export type Route =
  | { name: "home" }
  | { name: "child"; child: ChildSummary; membership: StaffMembership }
  | { name: "queue" }
  | { name: "feed"; child: ChildSummary };
