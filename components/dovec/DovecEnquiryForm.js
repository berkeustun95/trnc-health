import { useState, useRef, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, Linking, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import KeyboardAwareForm from '../KeyboardAwareForm'
import SearchModal from '../SearchModal'
import { Button, Card, InlineAlert } from '../ui'
import { colors, type, radii, TAP, font, press } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { countryCodeOptions } from '../../constants/countryCodes'
import {
  DOVEC_MESSAGE_MAX, validateEnquiry, buildLeadPayload, requestIdFor, classifyLead, OUTCOME_KEY, unitTypes, unitTypeLabel, privacyUrlFor, dovecCanSend,
} from '../../constants/dovec'
import { sendDovecLead } from '../../utils/loadDovec'
import { newId } from '../../utils/logContactEvent'

function Field({ label, error, children }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {!!error && <Text style={s.fieldError} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  )
}

// The enquiry form for one project. onSent(externalId) when Döveç's endpoint accepted it.
export default function DovecEnquiryForm({ project, lang, settings, onSent }) {
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [cc, setCc] = useState(null)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [unit, setUnit] = useState(null)
  const [consent, setConsent] = useState(false)
  const [picker, setPicker] = useState(false)
  const [touched, setTouched] = useState({})
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState(null)
  const idRef = useRef(null)
  const alive = useRef(true)
  const emailRef = useRef(null)
  const phoneRef = useRef(null)
  useEffect(() => () => { alive.current = false }, [])

  const fields = { name, cc, phone, email, message, consent }
  const v = validateEnquiry(fields)
  const units = unitTypes(project)
  const privacyUrl = privacyUrlFor(settings, lang)
  const canSend = dovecCanSend(v.ok, privacyUrl)
  const touch = k => setTouched(cur => (cur[k] ? cur : { ...cur, [k]: true }))
  const err = (k, key) => (touched[k] && v.errors[k] ? t(key, lang) : null)

  const submit = async () => {
    if (busy || !canSend) return
    setBusy(true); setErrorKey(null)
    const draft = buildLeadPayload({ ...fields, requestId: '', projectId: project.id, unitType: unit, lang })
    let netRetried = false, changedRetried = false
    for (;;) {
      idRef.current = requestIdFor(idRef.current, draft, newId)
      const res = await sendDovecLead({ ...draft, client_request_id: idRef.current.id })
      if (!alive.current) return
      const out = res.status === 0 ? { kind: 'network' } : classifyLead(res.status, res.body)
      if (out.kind === 'ok') { setBusy(false); onSent(out.externalId); return }
      // The same payload may be retried under the same id once; a refused or changed request starts over under a new id.
      if (out.kind === 'network' && !netRetried) { netRetried = true; continue }
      if (out.kind === 'changed' && !changedRetried) { changedRetried = true; idRef.current = null; continue }
      if (['rejected', 'invalid', 'consent', 'changed'].includes(out.kind)) idRef.current = null
      setErrorKey(OUTCOME_KEY[out.kind] || 'dovecErrGeneric')
      setBusy(false)
      return
    }
  }

  return (
    <KeyboardAwareForm>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Text style={s.project} numberOfLines={2}>{project.name}</Text>
        <Card style={s.card} padding={16}>
          <Text style={s.title} accessibilityRole="header">{t('dovecFormTitle', lang)}</Text>

          <Field label={t('dovecFormName', lang)} error={err('name', 'dovecErrName')}>
            <TextInput style={s.input} accessibilityLabel={t('dovecFormName', lang)} value={name} onChangeText={setName} onBlur={() => touch('name')} maxLength={120}
              autoCapitalize="words" autoCorrect={false} textContentType="name" returnKeyType="next"
              blurOnSubmit={false} onSubmitEditing={() => phoneRef.current?.focus()} />
          </Field>

          <Field label={t('dovecFormPhone', lang)} error={err('phone', 'dovecErrPhone')}>
            <View style={s.phoneRow}>
              <TouchableOpacity style={s.ccBtn} onPress={() => setPicker(true)} accessibilityRole="button"
                activeOpacity={press.small}
                accessibilityLabel={cc ? `${t('dovecFormCodeTitle', lang)}, ${cc}` : t('dovecFormCodeTitle', lang)}>
                <Text style={[s.ccText, !cc && s.ccPlaceholder]} numberOfLines={1}>{cc || t('dovecFormCode', lang)}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              <TextInput ref={phoneRef} style={[s.input, s.phoneInput]} accessibilityLabel={t('dovecFormPhone', lang)} value={phone} onChangeText={setPhone}
                onBlur={() => touch('phone')} keyboardType="phone-pad" textContentType="telephoneNumber" maxLength={20} />
            </View>
          </Field>

          <Field label={t('dovecFormEmail', lang)} error={err('email', 'dovecErrEmail')}>
            <TextInput ref={emailRef} style={s.input} accessibilityLabel={t('dovecFormEmail', lang)} value={email} onChangeText={setEmail} onBlur={() => touch('email')}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" maxLength={254} />
          </Field>

          {units.length > 0 && (
            <Field label={t('dovecFormUnit', lang)}>
              <View style={s.chips}>
                {units.map(u => {
                  const on = unit === u.type
                  return (
                    <TouchableOpacity key={u.type} style={[s.chip, on && s.chipOn]} onPress={() => setUnit(on ? null : u.type)} activeOpacity={press.small}
                      accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{unitTypeLabel(u.type, lang, t)}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
          )}

          <Field label={t('dovecFormMessage', lang)}>
            <TextInput style={[s.input, s.multiline]} accessibilityLabel={t('dovecFormMessage', lang)} value={message} onChangeText={setMessage} multiline textAlignVertical="top"
              maxLength={DOVEC_MESSAGE_MAX} />
            <Text style={s.counter}>{message.length}/{DOVEC_MESSAGE_MAX}</Text>
          </Field>

          <TouchableOpacity style={s.consent} onPress={() => setConsent(c => !c)} activeOpacity={press.small}
            accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
            <View style={[s.box, consent && s.boxOn]}>
              {consent && <Ionicons name="checkmark" size={16} color={colors.onPrimary} />}
            </View>
            <Text style={s.consentText}>{t('dovecFormConsent', lang)}</Text>
          </TouchableOpacity>
          {!!privacyUrl && (
            <TouchableOpacity style={s.privacy} onPress={() => Linking.openURL(privacyUrl).catch(() => {})} activeOpacity={press.small}
              accessibilityRole="link" accessibilityLabel={t('dovecPrivacyLink', lang)}>
              <Text style={s.privacyText}>{t('dovecPrivacyLink', lang)}</Text>
            </TouchableOpacity>
          )}

        </Card>
      </ScrollView>

      {/* Send sits in a bar under the scroll area, so the Android nav buttons never cover it at any scroll position. */}
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!!errorKey && <InlineAlert message={t(errorKey, lang)} style={s.alert} />}
        <Button fullWidth title={t('dovecFormSend', lang)} loading={busy} loadingTitle={t('dovecFormSending', lang)}
          disabled={!canSend} disabledHint={t(v.ok ? 'dovecFormPrivacyMissing' : 'dovecFormHint', lang)} onPress={submit} />
      </View>

      <SearchModal lang={lang} visible={picker === true} searchable title={t('dovecFormCodeTitle', lang)}
        searchPlaceholder={t('dovecFormCodeSearch', lang)} closeLabel={t('dovecClose', lang)} options={countryCodeOptions(lang)} value={cc}
        onSelect={v2 => { setCc(v2); setPicker(false) }} onClose={() => setPicker(false)} />
    </KeyboardAwareForm>
  )
}

const s = StyleSheet.create({
  project:    { ...type.rowTitle, color: colors.textSecondary, marginBottom: 12 },
  card:       { borderRadius: radii.card },
  title:      { ...type.sectionHeading, color: colors.textPrimary, marginBottom: 12 },
  field:      { marginBottom: 16 },
  label:      { ...type.meta, color: colors.textSecondary, marginBottom: 6 },
  fieldError: { ...type.small, color: colors.dangerInk, marginTop: 4 },
  input:      { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder,
                backgroundColor: 'transparent', ...type.body, fontSize: 15, color: colors.textPrimary },
  multiline:  { minHeight: 96, paddingTop: 12 },
  counter:    { ...type.caption, color: colors.textSecondary, textAlign: 'right', marginTop: 4 },
  phoneRow:   { flexDirection: 'row', gap: 8 },
  phoneInput: { flex: 1 },
  ccBtn:      { minWidth: 88, minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                borderRadius: radii.md, borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: 'transparent' },
  ccText:     { ...type.body, fontSize: 15, color: colors.textPrimary, flexShrink: 1 },
  ccPlaceholder: { color: colors.textSecondary },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { minHeight: TAP, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.fieldBorder,
                backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  chipOn:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText:   { ...type.body, color: colors.textPrimary },
  chipTextOn: { color: colors.primaryDark, fontFamily: font.bold },
  consent:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: TAP, paddingVertical: 6, marginBottom: 12 },
  box:        { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.fieldBorder, backgroundColor: 'transparent',
                alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn:      { backgroundColor: colors.primary, borderColor: colors.primary },
  consentText:{ ...type.small, color: colors.textPrimary, flex: 1 },
  privacy:    { alignSelf: 'flex-start', minHeight: TAP, justifyContent: 'center', marginLeft: 36, marginTop: -12, marginBottom: 8 },
  privacyText:{ ...type.small, color: colors.primary, textDecorationLine: 'underline' },
  alert:      { marginBottom: 12 },
  bar:        { flexShrink: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
})
