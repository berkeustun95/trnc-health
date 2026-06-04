import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

export default function ResetPasswordScreen({ onDone, lang = 'English' }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function submit() {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    setDone(true)
    setTimeout(onDone, 1500)
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        {!done && (
          <TouchableOpacity style={s.cancelBtn} onPress={onDone}>
            <Feather name="x" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        <Text style={s.title}>{t('setNewPassword', lang)}</Text>
        <Text style={s.sub}>{t('chooseNewPassword', lang)}</Text>

        {done ? (
          <Text style={s.successText}>{t('passwordUpdated', lang)}</Text>
        ) : (
          <>
            <Text style={s.label}>{t('newPassword', lang)}</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('atLeast8Chars', lang)}
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />

            <Text style={s.label}>{t('confirmPassword', lang)}</Text>
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t('repeatPassword', lang)}
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />

            {error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity
              style={[s.btn, (!password || !confirm || loading) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!password || !confirm || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>{t('updatePassword', lang)}</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  container:   { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  cancelBtn:   { position: 'absolute', top: 16, right: 0, padding: 8 },
  title:       { fontSize: 26, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 10 },
  sub:         { fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 22, marginBottom: 32 },
  label:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 },
  input:       { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 16, fontFamily: 'Inter_400Regular', backgroundColor: colors.surface, color: colors.textPrimary, marginBottom: 18 },
  error:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.danger, marginBottom: 12, textAlign: 'center' },
  btn:         { backgroundColor: colors.primary, borderRadius: 14, padding: 17, alignItems: 'center' },
  btnText:     { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  successText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.success, textAlign: 'center' },
})
