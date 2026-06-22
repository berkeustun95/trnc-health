import { useState } from 'react'
import { View, Text, Image, ImageBackground, TextInput, TouchableOpacity, StyleSheet,
         ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

export default function AuthScreen({ lang = 'English' }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState('customer')
  const [facilityType, setFacilityType] = useState('pharmacy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [signupDone, setSignupDone] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function submit() {
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !password.trim()) {
      setError(t('enterEmailAndPassword', lang))
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      setError(t('invalidEmail', lang))
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError(t('passwordTooShort', lang))
      return
    }
    setLoading(true)
    setError(null)
    const signupMeta = role === 'provider' ? { role, facilityType } : { role }
    const { error } = mode === 'signup'
      ? await supabase.auth.signUp({ email: trimmedEmail, password, options: { data: signupMeta, emailRedirectTo: 'ada://' } })
      : await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
    if (error) setError(error.message)
    else if (mode === 'signup') setSignupDone(true)
    setLoading(false)
  }

  async function sendReset() {
    if (!email.trim()) {
      setError(t('enterEmailFirst', lang))
      return
    }
    setResetLoading(true)
    setError(null)
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'ada://' })
    setResetLoading(false)
    setResetSent(true)
  }

  if (signupDone) {
    return (
      <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
        <View style={styles.overlay} />
      <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]}>
        <View style={styles.container}>
          <View style={styles.logoArea}>
            <Image source={require('../assets/logonobg.png')} style={styles.logoImg} resizeMode="contain" />
          </View>
          <View style={styles.formCard}>
            <View style={styles.resetSuccessWrap}>
              <View style={styles.resetSuccessIcon}>
                <Feather name="mail" size={28} color={colors.primary} />
              </View>
              <Text style={styles.resetSuccessTitle}>{t('accountCreated', lang)}</Text>
              <Text style={styles.resetSuccessSub}>
                {t('confirmEmailSub', lang)}{'\n'}<Text style={styles.resetEmail}>{email.trim()}</Text>
              </Text>
              <Text style={[styles.resetSuccessSub, { marginBottom: 32 }]}>{t('confirmEmailNote', lang)}</Text>
              <TouchableOpacity style={styles.submit} onPress={() => { setSignupDone(false); setMode('login'); setPassword('') }}>
                <Text style={styles.submitText}>{t('backToSignIn', lang)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
      </ImageBackground>
    )
  }

  if (showReset) {
    return (
      <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
        <View style={styles.overlay} />
      <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.logoArea}>
              <Image source={require('../assets/logonobg.png')} style={styles.logoImg} resizeMode="contain" />
            </View>

            {resetSent ? (
              <View style={styles.formCard}>
                <View style={styles.resetSuccessWrap}>
                  <View style={styles.resetSuccessIcon}>
                    <Feather name="mail" size={28} color={colors.primary} />
                  </View>
                  <Text style={styles.resetSuccessTitle}>{t('checkEmail', lang)}</Text>
                  <Text style={styles.resetSuccessSub}>
                    {t('resetEmailSentSub', lang)}{'\n'}<Text style={styles.resetEmail}>{email.trim()}</Text>
                  </Text>
                  <TouchableOpacity style={styles.submit} onPress={() => { setShowReset(false); setResetSent(false) }}>
                    <Text style={styles.submitText}>{t('backToSignIn', lang)}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.formCard}>
                <TouchableOpacity style={styles.backLink} onPress={() => { setShowReset(false); setError(null) }}>
                  <Feather name="arrow-left" size={16} color={colors.textSecondary} />
                  <Text style={styles.backLinkText}>{t('backToSignIn', lang)}</Text>
                </TouchableOpacity>

                <Text style={styles.resetTitle}>{t('resetPassword', lang)}</Text>
                <Text style={styles.resetSub}>{t('resetPasswordSub', lang)}</Text>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t('email', lang)}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity style={styles.submit} onPress={sendReset} disabled={resetLoading}>
                  {resetLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.submitText}>{t('sendResetLink', lang)}</Text>
                  }
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </ImageBackground>
    )
  }

  return (
    <ImageBackground source={require('../assets/auth-bg.png')} style={{ flex: 1 }} resizeMode="cover">
      <View style={styles.overlay} />
    <SafeAreaView style={[styles.safe, { backgroundColor: 'transparent' }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoArea}>
            <Image source={require('../assets/logonobg.png')} style={styles.logoImg} resizeMode="contain" />
          </View>

          <View style={styles.formCard}>
          <View style={styles.toggle}>
            {['login', 'signup'].map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, mode === m && styles.tabActive]}
                onPress={() => { setMode(m); setError(null) }}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {m === 'login' ? t('login', lang) : t('signup', lang)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('email', lang)}</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.fieldLabel}>{t('password', lang)}</Text>
              {mode === 'login' && (
                <TouchableOpacity onPress={() => { setShowReset(true); setError(null) }}>
                  <Text style={styles.forgotLink}>{t('forgotPassword', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {mode === 'signup' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('iAmA', lang)}</Text>
              <View style={styles.roleRow}>
                {[['customer', t('roleCustomer', lang)], ['provider', t('roleProvider', lang)], ['organizer', t('roleOrganizer', lang)]].map(([r, label]) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleBtn, role === r && styles.roleBtnActive]}
                    onPress={() => setRole(r)}
                  >
                    <Text style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {role === 'provider' && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>{t('selectFacilityType', lang)}</Text>
                  <View style={styles.facilityGrid}>
                    {[['pharmacy', t('facilityPharmacy', lang)], ['clinic', t('facilityClinic', lang)], ['hospital', t('facilityHospital', lang)], ['dentist', t('facilityDentist', lang)]].map(([ft, label]) => (
                      <TouchableOpacity
                        key={ft}
                        style={[styles.facilityBtn, facilityType === ft && styles.roleBtnActive]}
                        onPress={() => setFacilityType(ft)}
                      >
                        <Text style={[styles.roleBtnText, facilityType === ft && styles.roleBtnTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitText}>{mode === 'login' ? t('login', lang) : t('createAccount', lang)}</Text>
            }
          </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ImageBackground>
  )
}

const styles = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: 'transparent' },
  formCard:          { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 24, padding: 24, paddingTop: 20 },
  overlay:           { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.55)' },
  kav:               { flex: 1 },
  container:         { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  logoArea:          { alignItems: 'center', marginBottom: 40 },
  logoImg:           { width: 460, height: 180 },
  toggle:            { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 14, marginBottom: 28, padding: 3 },
  tab:               { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabActive:         { backgroundColor: colors.surface, shadowColor: colors.textPrimary, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabText:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:     { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  fieldGroup:        { marginBottom: 18 },
  fieldLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  passwordLabelRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  forgotLink:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  input:             { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },
  passwordWrap:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  passwordInput:     { flex: 1, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  eyeBtn:            { paddingHorizontal: 14 },
  roleRow:           { flexDirection: 'row', gap: 8 },
  roleBtn:           { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  facilityGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  facilityBtn:       { width: '47%', borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  roleBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleBtnText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  roleBtnTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  error:             { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  submit:            { backgroundColor: colors.primary, borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 4 },
  submitText:        { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },

  // Reset flow
  backLink:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  backLinkText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  resetTitle:         { fontSize: 24, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  resetSub:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 21, marginBottom: 28 },
  resetSuccessWrap:   { alignItems: 'center' },
  resetSuccessIcon:   { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginBottom: 20, ...shadow },
  resetSuccessTitle:  { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  resetSuccessSub:    { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  resetEmail:         { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
})
