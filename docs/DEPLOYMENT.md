# Deploy Daily Updates to iPhone

This guide creates a private iPhone build backed by a hosted API and database.
It deliberately keeps real child data out of the demo.

## 1. Deploy the API and PostgreSQL on Railway

1. In Railway, create a project from the GitHub repository.
2. Add a PostgreSQL service to the same project.
3. Give the API service a public Railway domain.
4. Set these API service variables:

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   HOST=0.0.0.0
   AUTH_ISSUER=https://YOUR_AUTH0_TENANT/
   AUTH_AUDIENCE=https://daily-updates-api
   AUTH_JWKS_URL=https://YOUR_AUTH0_TENANT/.well-known/jwks.json
   AUTH_ALGORITHMS=RS256
   ANTHROPIC_API_KEY=YOUR_SECRET_KEY
   CORS_ORIGINS=
   ```

Railway reads `railway.json`, runs `npm run db:migrate` before each deploy,
starts the API with `npm start`, and checks `/health` before marking it ready.

For a synthetic portfolio demo only, open a Railway shell for the API service
and deliberately load the seed once:

```bash
ALLOW_DEMO_SEED=yes npm run db:seed:demo
```

Never run that command against a database containing real data.

## 2. Create the Auth0 mobile client

Create an Auth0 **Native** application. Keep the existing API and use its
identifier as `AUTH_AUDIENCE`.

In the Native application's settings add this value to both **Allowed Callback
URLs** and **Allowed Logout URLs**:

```text
dailyupdates://auth/callback
```

The mobile Client ID is public. Do not put the Auth0 Client Secret into Expo.

After the first login, Daily Updates shows the Auth0 user subject on the
"not set up yet" screen. That identity must be linked to a role in the hosted
database before it can see a child.

## 3. Configure Expo and EAS

From `app/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

Create these EAS environment variables for the `preview` environment:

```text
EXPO_PUBLIC_AUTH_ISSUER=https://YOUR_AUTH0_TENANT/
EXPO_PUBLIC_AUTH_CLIENT_ID=YOUR_NATIVE_APPLICATION_CLIENT_ID
EXPO_PUBLIC_AUTH_AUDIENCE=https://daily-updates-api
EXPO_PUBLIC_API_URL=https://YOUR_RAILWAY_API_DOMAIN
```

All four variables are intentionally public app configuration, not secrets.

## 4. Build and install the preview

Register the iPhone, then create the internal build:

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

Open the install link or QR code on the registered iPhone. On recent iOS
versions, Developer Mode may need to be enabled before launching an internally
distributed build.

## 5. Move to TestFlight

Once the private build and login flow work:

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production
```

The production profile is the store/TestFlight build. Apple manages tester
access in App Store Connect.
