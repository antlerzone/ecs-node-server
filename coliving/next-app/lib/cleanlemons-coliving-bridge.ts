/**
 * Cleanlemons client portal (popup) → Coliving operator company (opener) after OAuth verify + Allow.
 * Keep in sync with `cleanlemon-portal-constants.ts` COLIVING_CLEANLEMONS_LINK_VERIFY_DONE.
 */
export const COLIVING_CLEANLEMONS_LINK_VERIFY_DONE = "COLIVING_CLEANLEMONS_LINK_VERIFY_DONE"

/** Origins allowed to postMessage the bridge event to Coliving (popup page origin). */
export const CLEANLEMONS_PORTAL_POSTMESSAGE_ORIGINS: string[] = [
  "https://portal.cleanlemons.com",
  "http://localhost:3100",
  "http://127.0.0.1:3100",
]
