// The gate on cron-only functions.   node scripts/test-cron-auth.mjs
import { callerHoldsSecretKey } from '../supabase/functions/_shared/cron-auth.mjs'

let bad = 0
const t = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${name}`) }
const req = a => new Request('https://x.test', { headers: a ? { Authorization: a } : {} })
const env = o => k => o[k]
const KEYS = env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_abc', other: 'sb_secret_def' }) })

t('a secret key passes', callerHoldsSecretKey(req('Bearer sb_secret_abc'), KEYS), true)
t('any named secret key passes', callerHoldsSecretKey(req('Bearer sb_secret_def'), KEYS), true)
t('no header is refused', callerHoldsSecretKey(req(), KEYS), false)
t('an empty bearer is refused', callerHoldsSecretKey(req('Bearer '), KEYS), false)
t('another key is refused', callerHoldsSecretKey(req('Bearer sb_secret_nope'), KEYS), false)
t('a prefix of a key is refused', callerHoldsSecretKey(req('Bearer sb_secret_ab'), KEYS), false)
t('the publishable key is refused', callerHoldsSecretKey(req('Bearer sb_publishable_x'), KEYS), false)
t('a user JWT is refused', callerHoldsSecretKey(req('Bearer eyJh.eyJz.sig'), KEYS), false)
t('no keys configured refuses everyone', callerHoldsSecretKey(req('Bearer sb_secret_abc'), env({})), false)
t('malformed config refuses everyone', callerHoldsSecretKey(req('Bearer {'), env({ SUPABASE_SECRET_KEYS: '{' })), false)
t('an empty key value never matches', callerHoldsSecretKey(req('Bearer '), env({ SUPABASE_SECRET_KEYS: '{"a":""}' })), false)
console.log(bad ? `\nFAILED: ${bad}` : '\nall passed')
process.exit(bad ? 1 : 0)
