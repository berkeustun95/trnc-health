import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { notifyAdmins } from '../utils/notify'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'
import KeyboardAwareForm from './KeyboardAwareForm'

const REASONS = [
  { key: 'offensive',  label: 'reasonOffensive' },
  { key: 'harassment', label: 'reasonHarassment' },
  { key: 'spam',       label: 'reasonSpam' },
  { key: 'false_info', label: 'reasonFalseInfo' },
  { key: 'other',      label: 'reasonOther' },
]

// A report is worthless if it sits unseen — the 24h commitment depends on the
// admin being pushed, not on them opening the dashboard.
//
// This used to read admin profiles here for their push tokens. RLS gives a non-admin
// zero rows, so `admins` was always empty and the `for` loop ran ZERO times — meaning
// neither the push nor the notifications row was ever written. No admin had been
// alerted to a report since this shipped, and nothing surfaced it, because an empty
// list is what a genuinely admin-less database would also produce.
//
// notify_admins() (20260923) resolves admins, composes the copy and sends the push
// server-side. It authorizes against the caller's OWN content_reports row, so it also
// cannot be used to spam admins about a report nobody filed.

export default function ContentReportMenu({ contentType, contentId, lang = 'English', style, onBlocked, onRequireAccount, blockUserId = null }) {
  const [open, setOpen]       = useState(false)
  const [step, setStep]       = useState('menu')   // menu | form | done | blockConfirm | blockDone
  const [reason, setReason]   = useState(null)
  const [details, setDetails] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [didBlock, setDidBlock] = useState(false)

  // Reviews are the only surface where one user sees another user's content, so
  // they are the only place a block is meaningful. Questions/answers are a
  // private thread with the business — the RPC rejects them server-side too.
  // ─── TWO DIFFERENT BLOCKS, AND THEY ARE NOT THE SAME VERB ─────────────────
  //
  // `block_content_author(type, id)` blocks WHOEVER WROTE THIS — the reviewer stays
  // anonymous and their id is resolved server-side and never returned. It is the right
  // shape for a review and it rejects every other content type server-side.
  //
  // `block_user(uuid)` (20261029) blocks A PERSON you are already looking at, and also
  // CLOSES any live conversation with them, because a block you can still be messaged
  // through is not a block. Passing `blockUserId` selects it.
  //
  // Not offered on a message: a message bubble is a piece of content, and blocking its
  // sender belongs in the thread header where the person is, not on one of their
  // sentences. One place per verb.
  const blocksPerson = blockUserId != null
  const canBlock   = contentType === 'review' || blocksPerson
  const isFacility = contentType === 'facility'
  // A private message is content, but reporting one has a consequence the other surfaces
  // do not: it makes that single message readable by an admin, who otherwise can read
  // NOTHING in anybody's inbox. The copy says so — see reportMessageSub.
  const isMessage  = contentType === 'message'
  // A student-list entry is a PERSON, not a piece of content, and "Report this content /
  // we remove violating content" reads as a category error over somebody's name. Same
  // shape as the facility branch above — copy only; the insert is identical.
  // Slice 5 resolved the note that used to sit here: the profile page now passes
  // `blockUserId`, which turns the block row into block_user(uuid).
  const isProfile  = contentType === 'profile'

  function close() {
    setOpen(false)
    setStep('menu')
    setReason(null)
    setDetails('')
    setError(null)
    if (didBlock) { setDidBlock(false); onBlocked?.() }
  }

  async function blockAuthor() {
    if (saving) return
    setSaving(true)
    setError(null)
    // The author's id is resolved server-side and never returned — the blocker
    // never learns who wrote the (anonymous) review they blocked.
    const { error: err } = blocksPerson
      ? await supabase.rpc('block_user', { p_user_id: blockUserId })
      : await supabase.rpc('block_content_author', {
          p_content_type: contentType,
          p_content_id:   contentId,
        })
    setSaving(false)
    if (err) { setError(t('blockError', lang)); return }
    setDidBlock(true)
    setStep('blockDone')
  }

  async function submit() {
    if (!reason || saving) return
    setSaving(true)
    setError(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setError(t('reportError', lang)); setSaving(false); return }

    const { error: err } = await supabase.from('content_reports').insert({
      reporter_id:  session.user.id,
      content_type: contentType,
      content_id:   contentId,
      reason,
      details:      details.trim() || null,
    })

    setSaving(false)

    if (err) {
      if (err.code === '23505')                        setError(t('reportAlready', lang))
      else if (err.message?.includes('REPORT_RATE_LIMIT')) setError(t('reportRateLimit', lang))
      else                                             setError(t('reportError', lang))
      return
    }

    setStep('done')
    notifyAdmins('content_report', contentId)
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => { if (onRequireAccount?.('gateReport')) return; setOpen(true) }}
        style={[s.trigger, style]}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={t('reportContent', lang)}
      >
        <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAwareForm>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={close}>
          <TouchableOpacity style={s.sheet} activeOpacity={1}>

            {step === 'menu' && (
              <>
                <TouchableOpacity style={s.actionRow} onPress={() => setStep('form')}>
                  <Ionicons name="flag-outline" size={18} color={colors.danger} />
                  <Text style={s.actionText}>{t('reportContent', lang)}</Text>
                </TouchableOpacity>
                {canBlock && (
                  <TouchableOpacity style={s.actionRow} onPress={() => setStep('blockConfirm')}>
                    <Ionicons name="ban-outline" size={18} color={colors.danger} />
                    <Text style={s.actionText}>{t(blocksPerson ? 'msgBlockPerson' : 'blockReviewer', lang)}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.cancelBtn} onPress={close}>
                  <Text style={s.cancelText}>{t('cancel', lang)}</Text>
                </TouchableOpacity>
              </>
            )}

            {step === 'blockConfirm' && (
              <>
                <Text style={s.title}>{t(blocksPerson ? 'msgBlockPersonTitle' : 'blockReviewerTitle', lang)}</Text>
                <Text style={s.sub}>{t(blocksPerson ? 'msgBlockPersonBody' : 'blockReviewerBody', lang)}</Text>
                {error ? <Text style={s.error}>{error}</Text> : null}
                <View style={s.btnRow}>
                  <TouchableOpacity style={s.secondaryBtn} onPress={close}>
                    <Text style={s.secondaryBtnText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.dangerBtn, saving && { opacity: 0.45 }]} onPress={blockAuthor} disabled={saving}>
                    {saving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.dangerBtnText}>{t('blockConfirmBtn', lang)}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {step === 'blockDone' && (
              <View style={s.doneWrap}>
                <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                <Text style={s.doneTitle}>{t(blocksPerson ? 'msgBlockPersonDone' : 'blockDoneTitle', lang)}</Text>
                <Text style={s.doneBody}>{t(blocksPerson ? 'msgBlockPersonDoneBody' : 'blockDoneBody', lang)}</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={close}>
                  <Text style={s.primaryBtnText}>{t('done', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'form' && (
              <>
                <Text style={s.title}>{t(isMessage ? 'reportMessageTitle' : isProfile ? 'reportProfileTitle' : isFacility ? 'reportBusinessTitle' : 'reportTitle', lang)}</Text>
                <Text style={s.sub}>{t(isMessage ? 'reportMessageSub' : isProfile ? 'reportProfileSub' : isFacility ? 'reportBusinessSub' : 'reportSubtitle', lang)}</Text>

                {REASONS.map(r => (
                  <TouchableOpacity
                    key={r.key}
                    style={[s.reasonRow, reason === r.key && s.reasonRowActive]}
                    onPress={() => setReason(r.key)}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={reason === r.key ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={reason === r.key ? colors.primary : colors.textSecondary}
                    />
                    <Text style={[s.reasonText, reason === r.key && s.reasonTextActive]}>{t(r.label, lang)}</Text>
                  </TouchableOpacity>
                ))}

                <TextInput
                  style={s.detailsInput}
                  value={details}
                  onChangeText={setDetails}
                  placeholder={t('reportDetailsPlaceholder', lang)}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                />

                {error ? <Text style={s.error}>{error}</Text> : null}

                <View style={s.btnRow}>
                  <TouchableOpacity style={s.secondaryBtn} onPress={close}>
                    <Text style={s.secondaryBtnText}>{t('cancel', lang)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.dangerBtn, (!reason || saving) && { opacity: 0.45 }]}
                    onPress={submit}
                    disabled={!reason || saving}
                  >
                    {saving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.dangerBtnText}>{t('submitReport', lang)}</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {step === 'done' && (
              <View style={s.doneWrap}>
                <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                <Text style={s.doneTitle}>{t('reportSentTitle', lang)}</Text>
                <Text style={s.doneBody}>{t('reportSentBody', lang)}</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={close}>
                  <Text style={s.primaryBtnText}>{t('done', lang)}</Text>
                </TouchableOpacity>
              </View>
            )}

          </TouchableOpacity>
        </TouchableOpacity>
        </KeyboardAwareForm>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  trigger:         { padding: 4 },
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:           { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, ...shadow },

  actionRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 4 },
  actionText:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.danger },
  cancelBtn:       { marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.cardBg, alignItems: 'center' },
  cancelText:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },

  title:           { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4 },
  sub:             { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 18, marginBottom: 16 },

  reasonRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: 'transparent', marginBottom: 4 },
  reasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  reasonText:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, flex: 1 },
  reasonTextActive:{ fontFamily: 'Inter_700Bold', color: colors.primary },

  detailsInput:    { marginTop: 10, minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardBg, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  error:           { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 10 },

  btnRow:          { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryBtn:    { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.cardBg, alignItems: 'center' },
  secondaryBtnText:{ fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dangerBtn:       { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerBtnText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },

  doneWrap:        { alignItems: 'center', paddingVertical: 8 },
  doneTitle:       { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 12, marginBottom: 6 },
  doneBody:        { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  primaryBtn:      { alignSelf: 'stretch', paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center' },
  primaryBtnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
