// Google OAuth client IDs for native sign-in.
//
// PUBLIC IDENTIFIERS, NOT SECRETS: they ship inside the binary and travel in every OAuth
// request. Literals rather than EXPO_PUBLIC_* env vars on purpose — an env var has to agree
// in `eas env` AND the local .env, and a missing one fails silently, the way a Maps key with
// the wrong SHA-1 renders a blank map with no error.
//
// The Web client is the AUDIENCE of the idToken that Supabase verifies (the Google
// provider's Authorized Client IDs). It lives in Google Cloud project 441674392222, which is
// NOT the Firebase project behind google-services.json (642226758237) — so the iOS client and
// both Android clients (upload SHA-1 + Play App Signing SHA-1) must be created in 441674392222.
export const GOOGLE_WEB_CLIENT_ID = '441674392222-tllp5h2bsuoreedpo5fd6f2ep01skssb.apps.googleusercontent.com'
