/** Persisted selected operator id (`cln_operatordetail.id` / legacy `cln_operator.id`) for Cleanlemons portal. */
export const CLEANLEMONS_ACTIVE_OPERATOR_ID_KEY = 'cleanlemons_active_operator_id'

/** Popup OAuth: `auth/callback` notifies opener so parent can `syncSessionFromStorage()`. */
export const CLEANLEMONS_PORTAL_AUTH_SUCCESS_MSG = 'CLEANLEMONS_PORTAL_AUTH_SUCCESS'

/** Popup flow uses localStorage (shared with `window.open`); sessionStorage is per-tab only. */
export const CLEANLEMONS_OAUTH_POPUP_FLAG_KEY = 'cleanlemons_oauth_popup'
export const CLEANLEMONS_AFTER_AUTH_REDIRECT_KEY = 'cleanlemons_after_auth_redirect'

/** After Coliving↔Cleanlemons link Allow — notify Coliving opener (must match docs/nextjs-migration/lib/cleanlemons-coliving-bridge). */
export const COLIVING_CLEANLEMONS_LINK_VERIFY_DONE = 'COLIVING_CLEANLEMONS_LINK_VERIFY_DONE'
