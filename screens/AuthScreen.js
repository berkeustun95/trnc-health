import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet,
         ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { colors } from '../constants/theme'

export default function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('customer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setLoading(true)
    setError(null)
    const { error } = mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { role } } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <SafeAreaView style={styles.safe}>
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
            <View style={styles.logoMark}>
              <Text style={styles.logoPlus}>+</Text>
            </View>
            <Text style={styles.wordmark}>TRNC Health</Text>
            <Text style={styles.tagline}>Your health guide in North Cyprus</Text>
          </View>

          <View style={styles.toggle}>
            {['login', 'signup'].map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, mode === m && styles.tabActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.border}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.border}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          {mode === 'signup' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>I am a</Text>
              <View style={styles.roleRow}>
                {[['customer', 'Patient'], ['provider', 'Healthcare provider']].map(([r, label]) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleBtn, role === r && styles.roleBtnActive]}
                    onPress={() => setRole(r)}
                  >
                    <Text style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:              { flex: 1, backgroundColor: colors.bg },
  kav:               { flex: 1 },
  container:         { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  logoArea:          { alignItems: 'center', marginBottom: 40 },
  logoMark:          { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  logoPlus:          { fontSize: 30, color: '#fff', fontFamily: 'Inter_400Regular', lineHeight: 36 },
  wordmark:          { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.5 },
  tagline:           { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 5 },
  toggle:            { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, marginBottom: 28, padding: 3 },
  tab:               { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive:         { backgroundColor: colors.surface, shadowColor: colors.textPrimary, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText:           { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:     { fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  fieldGroup:        { marginBottom: 18 },
  fieldLabel:        { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:             { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary },
  roleRow:           { flexDirection: 'row', gap: 10 },
  roleBtn:           { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 13, alignItems: 'center', backgroundColor: colors.surface },
  roleBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleBtnText:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  roleBtnTextActive: { fontFamily: 'Inter_700Bold', color: colors.primary },
  error:             { fontFamily: 'Inter_400Regular', color: colors.danger, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  submit:            { backgroundColor: colors.accent, borderRadius: 12, padding: 17, alignItems: 'center', marginTop: 4 },
  submitText:        { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
})
