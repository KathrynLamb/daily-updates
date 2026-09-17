// app/src/config.ts
//
// Settings the app reads at build time from app/.env. All of them are
// public: they are sent to every browser that loads the app, so never
// put a secret here.

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is missing. Copy app/.env.example to app/.env.`);
  }

  return value.trim();
}

// Expo only inlines EXPO_PUBLIC_ variables when they are read directly
// like this, so each one is named in full.
const issuer = required(
  "EXPO_PUBLIC_AUTH_ISSUER",
  process.env.EXPO_PUBLIC_AUTH_ISSUER
);

export const config = {
  // The identity provider, exactly as the API expects it (Auth0 issuers
  // end with a slash).
  authIssuer: issuer,

  // Discovery wants the issuer without the trailing slash, or it asks
  // for "//.well-known/openid-configuration".
  authDiscoveryUrl: issuer.replace(/\/+$/, ""),

  authClientId: required(
    "EXPO_PUBLIC_AUTH_CLIENT_ID",
    process.env.EXPO_PUBLIC_AUTH_CLIENT_ID
  ),

  authAudience: required(
    "EXPO_PUBLIC_AUTH_AUDIENCE",
    process.env.EXPO_PUBLIC_AUTH_AUDIENCE
  ),

  apiUrl: required(
    "EXPO_PUBLIC_API_URL",
    process.env.EXPO_PUBLIC_API_URL
  ).replace(/\/+$/, ""),
};
