import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet,
         ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { supabase } from '../lib/supabase'

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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={styles.heading}>TRNC Health</Text>

      <View style={styles.toggle}>
        {['login', 'signup'].map(m => (
          <TouchableOpacity key={m} style={[styles.tab, mode === m && styles.tabActive]} onPress={() => setMode(m)}>
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === 'login' ? 'Log in' : 'Sign up'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput style={styles.input} placeholder="Email"
        autoCapitalize="none" keyboardType="email-address"
        value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password"
        secureTextEntry value={password} onChangeText={setPassword} />

      {mode === 'signup' && (
        <View style={styles.roleRow}>
          {[['customer', 'I need care'], ['provider', 'I provide care']].map(([r, label]) => (
            <TouchableOpacity key={r}
              style={[styles.roleBtn, role === r && styles.roleBtnActive]}
              onPress={() => setRole(r)}
            >
              <Text style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error != null && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.submit} onPress={submit} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>
        }
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container:         { flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: '#fff' },
  heading:           { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 32, color: '#111' },
  toggle:            { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 10, marginBottom: 20, padding: 4 },
  tab:               { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive:         { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText:           { fontSize: 15, color: '#6b7280', fontWeight: '500' },
  tabTextActive:     { color: '#111', fontWeight: '700' },
  input:             { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12, backgroundColor: '#fafafa' },
  roleRow:           { flexDirection: 'row', gap: 10, marginBottom: 12 },
  roleBtn:           { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, alignItems: 'center' },
  roleBtnActive:     { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  roleBtnText:       { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  roleBtnTextActive: { color: '#2563eb', fontWeight: '700' },
  error:             { color: '#dc2626', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  submit:            { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  submitText:        { color: '#fff', fontSize: 16, fontWeight: '700' },
})
