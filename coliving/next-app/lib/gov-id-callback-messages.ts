/** Shared copy for Gov ID OAuth / Singpass callback query `reason` (portal toast + hints). */

export const GOV_ID_ERROR_HINTS: Record<string, string> = {
  GOV_ID_SWITCH_REQUIRED:
    "This account already uses a different government ID. Sign in, open Profile → Verification, disconnect the current ID, then connect the one you want.",
  NO_EMAIL_FROM_IDP:
    "Singpass did not return an email (unusual). Use the email step on this page if you were redirected here to complete registration.",
  SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_REQUIRED:
    "Singpass: API host is missing the JWKS encryption private key. Set SINGPASS_OIDC_DECRYPTION_PRIVATE_KEY_PATH (or inline PEM) to the EC key that pairs with use=enc in your Singpass app JWKS — not the signing key. See root .env.example.",
  ID_TOKEN_DECRYPT_FAILED:
    "Singpass: id_token could not be decrypted. Confirm the enc private key matches the kid Singpass uses (check api logs: [gov-id] id_token JWE decrypt failed).",
  ID_TOKEN_VERIFY_FAILED:
    "Singpass: id_token signature or claims check failed (issuer, audience, or nonce).",
  ID_TOKEN_NONCE_MISMATCH: "Singpass: id_token nonce did not match this login session.",
  access_denied:
    "Singpass or Myinfo was cancelled or not approved. You can still sign in with email, Google, or Facebook below.",
}

export function formatGovIdErrorReason(raw: string): string {
  const key = decodeURIComponent(raw).trim()
  if (GOV_ID_ERROR_HINTS[key]) return GOV_ID_ERROR_HINTS[key]
  if (key.length > 220) return `${key.slice(0, 217)}…`
  return key
}
