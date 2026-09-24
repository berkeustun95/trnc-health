// ─── "We've updated our Privacy Policy" — who sees the notice ───────────────
//
// The policy promises: "When we make a material change we will update the version number
// and the 'Last updated' date, and we will tell you in the app." Bumping LEGAL_VERSION on
// its own tells nobody (it only changes what NEW acceptances record) — this is the telling.
//
// Pure, so scripts/check-policy-notice.mjs can assert every branch without a device.
//
//   seen         the LEGAL_VERSION this device last showed the notice for (AsyncStorage),
//                or null
//   termsVersion profiles.terms_version — what the account accepted, or null (guest, or an
//                account from before consent was recorded)
//   returning    this device had finished onboarding BEFORE this launch — i.e. it existed
//                under an older policy. A brand-new install accepts the current version at
//                signup and must not be told the policy "changed".
//
// ⚠ Dismissing the notice is NOT acceptance and writes nothing to profiles. Re-asking for
//   consent is a separate decision (constants/legal/index.js says the same).
export function shouldShowPolicyNotice({ seen, termsVersion, current, returning }) {
  if (!current || seen === current) return false
  if (termsVersion === current) return false               // accepted this very version
  if (termsVersion && termsVersion < current) return true  // accepted an older one
  return !!returning                                        // a guest/older device from before
}
