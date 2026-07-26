import { KeyboardAvoidingView, Platform } from 'react-native'

// OTA keyboard-avoidance wrapper (RN-core only — no native deps).
// iOS: 'padding'. Android: 'height' (replaces the old no-op behavior={undefined}).
// Thin by design: wraps only, so fixed headers, existing ScrollView props, and
// layout stay identical. Safe inside a <Modal>. keyboardVerticalOffset=0 because
// this app has no nav header (custom SafeAreaView routing).
// FUTURE: replace with react-native-keyboard-controller in a native build.
export default function KeyboardAwareForm({ children, style }) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {children}
    </KeyboardAvoidingView>
  )
}
