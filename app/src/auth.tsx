// app/src/auth.tsx
//
// Logs people in with Auth0's own login page, using the authorisation
// code flow with PKCE, and keeps their access token in memory only.
// Reloading the page means pressing "Log in" again; Auth0 remembers the
// session, so it is usually one click.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  exchangeCodeAsync,
  makeRedirectUri,
  useAuthRequest,
  useAutoDiscovery,
} from "expo-auth-session";
import { ApiError, createApi, type Api } from "./api";
import { config } from "./config";
import type { Me } from "./types";

// Closes the login popup on web once Auth0 sends the user back.
WebBrowser.maybeCompleteAuthSession();

type AuthState =
  | { status: "signed_out"; message?: string }
  | { status: "signing_in" }
  | { status: "not_linked"; token: string; subject: string }
  | { status: "ready"; token: string; subject: string; me: Me }
  | { status: "failed"; message: string };

type AuthContextValue = {
  state: AuthState;
  canLogIn: boolean;
  logIn: () => void;
  logOut: () => void;
  retry: () => void;
  api: Api | null;
  me: Me | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function tokenClaims(token: string): { sub?: string; exp?: number } {
  try {
    const payload = token.split(".")[1] ?? "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const discovery = useAutoDiscovery(config.authDiscoveryUrl);
  // Keep the native callback stable across local, preview and store builds.
  // Web builds still use their current browser URL.
  const redirectUri = makeRedirectUri({
    scheme: "dailyupdates",
    path: "auth/callback",
  });
  const [state, setState] = useState<AuthState>({ status: "signed_out" });

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: config.authClientId,
      redirectUri,
      scopes: ["openid"],
      usePKCE: true,
      extraParams: {
        audience: config.authAudience,
      },
    },
    discovery
  );

  const signOutLocally = useCallback((message?: string) => {
    setState({ status: "signed_out", message });
  }, []);

  // A 401 later on means the session ended or access was removed.
  const handleUnauthorised = useCallback(() => {
    signOutLocally("Your session has ended. Log in again.");
  }, [signOutLocally]);

  const loadAccount = useCallback(
    async (token: string) => {
      const subject = tokenClaims(token).sub ?? "unknown";

      try {
        // Checked here rather than through handleUnauthorised, because a
        // 401 on the very first request means the login is fine but the
        // account has not been given access yet.
        const me = await createApi(token, () => {}).get<Me>("/me");
        setState({ status: "ready", token, subject, me });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: "not_linked", token, subject });
          return;
        }

        setState({
          status: "failed",
          message:
            error instanceof Error ? error.message : "Could not load your account.",
        });
      }
    },
    []
  );

  useEffect(() => {
    if (!response) {
      return;
    }

    if (response.type === "error") {
      setState({
        status: "failed",
        message:
          response.params.error_description ??
          response.error?.message ??
          "Login failed.",
      });
      return;
    }

    if (response.type !== "success" || !request?.codeVerifier || !discovery) {
      signOutLocally();
      return;
    }

    let cancelled = false;

    exchangeCodeAsync(
      {
        clientId: config.authClientId,
        code: response.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      discovery
    )
      .then((tokens) => {
        if (!cancelled) {
          return loadAccount(tokens.accessToken);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "failed",
            message: "Login worked, but getting your access failed. Try again.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [response]);

  const logIn = useCallback(() => {
    setState({ status: "signing_in" });
    promptAsync().catch(() => signOutLocally("Login was interrupted."));
  }, [promptAsync, signOutLocally]);

  // Ends the Auth0 session too, so the next login can be a different
  // account.
  const logOut = useCallback(() => {
    const logoutUrl =
      `${config.authIssuer.replace(/\/?$/, "/")}v2/logout` +
      `?client_id=${encodeURIComponent(config.authClientId)}` +
      `&returnTo=${encodeURIComponent(redirectUri)}`;

    signOutLocally();

    if (Platform.OS === "web") {
      window.location.assign(logoutUrl);
    } else {
      WebBrowser.openAuthSessionAsync(logoutUrl, redirectUri).catch(() => {});
    }
  }, [redirectUri, signOutLocally]);

  const retry = useCallback(() => {
    if (state.status === "not_linked") {
      void loadAccount(state.token);
    } else {
      signOutLocally();
    }
  }, [state, loadAccount, signOutLocally]);

  const token =
    state.status === "ready" || state.status === "not_linked"
      ? state.token
      : null;

  const api = useMemo(
    () => (token ? createApi(token, handleUnauthorised) : null),
    [token, handleUnauthorised]
  );

  const value: AuthContextValue = {
    state,
    canLogIn: Boolean(request && discovery),
    logIn,
    logOut,
    retry,
    api: state.status === "ready" ? api : null,
    me: state.status === "ready" ? state.me : null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
