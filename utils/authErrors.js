// Supabase auth failures → one of our own i18n keys. The server's message is English and
// written for developers, so it is never shown. Known codes first (auth-js 2.x `error.code`),
// then the HTTP status, then a network failure (no status), then a generic fallback that
// still says what to do. Used by AuthScreen for sign-in, sign-up and password reset.
const BY_CODE = {
  invalid_credentials:          'authErrInvalidCreds',
  email_not_confirmed:          'authErrNotConfirmed',
  user_already_exists:          'authErrUserExists',
  email_exists:                 'authErrUserExists',
  weak_password:                'authErrWeakPassword',
  email_address_invalid:        'invalidEmail',
  over_email_send_rate_limit:   'authErrRateLimit',
  over_request_rate_limit:      'authErrRateLimit',
}

export function authErrorKey(error) {
  if (!error) return null
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]
  if (error.status === 429) return 'authErrRateLimit'
  if (error.status === 400 && /invalid login credentials/i.test(error.message || '')) return 'authErrInvalidCreds'
  if (!error.status || error.name === 'AuthRetryableFetchError') return 'authErrNetwork'
  return 'authErrGeneric'
}
