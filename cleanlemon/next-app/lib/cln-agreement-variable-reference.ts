import clnAgreementVariableReference from '../../../src/modules/cleanlemon/cln-agreement-variable-reference.json'

/** Same file as Node `agreement.service.js` — General keys and docx reference version. */
export const CLN_AGREEMENT_VAR_REF = clnAgreementVariableReference as {
  generalKeys: readonly string[]
  docxReferenceVersion: number
}

/** `{{key}}` strings for operator agreement template reference UI (General section). */
export function clnGeneralVariableTags(): string[] {
  return CLN_AGREEMENT_VAR_REF.generalKeys.map((k) => `{{${k}}}`)
}

/** Cache-bust query for the variables reference .docx download. */
export function clnAgreementVariablesReferenceDocxQuery(): string {
  const v = CLN_AGREEMENT_VAR_REF.docxReferenceVersion
  return `v=${v}&_=${Date.now()}`
}
