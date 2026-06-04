import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'

const PRIVACY = `Last updated: June 2026

ADA ("we", "our", "the app") is a health-access directory for newcomers in Northern Cyprus (TRNC). This policy explains what data we collect, why, and how we protect it.

1. DATA WE COLLECT
• Account data: email address, password (hashed by Supabase Auth — we never see it), and the role you choose (customer or provider).
• Profile data you provide: full name, phone number, nationality, preferred language.
• Push notification token: stored to send you duty pharmacy alerts. You can disable this in your device settings at any time.
• Appointment records: facility, requested time, and status.
• Reviews and questions you submit.
• Usage data: we do not use analytics SDKs or third-party trackers.

2. HOW WE USE YOUR DATA
• To operate the app: show you relevant facilities, manage appointments, send notifications.
• To personalise your experience: display content in your preferred language.
• We do not sell, rent, or share your personal data with third parties for marketing.

3. DATA STORAGE
All data is stored on Supabase (EU region). Row-Level Security (RLS) policies ensure you can only access your own records. Your data is never visible to other customers.

4. YOUR RIGHTS
You may request deletion of your account and all associated data at any time by emailing us. We will process deletion within 30 days.

5. CHILDREN
ADA is not directed at children under 13. We do not knowingly collect data from minors.

6. CHANGES
We may update this policy. Continued use of the app after changes means you accept the updated policy.

7. CONTACT
For privacy questions or deletion requests: berke.ustun95@gmail.com`

const TERMS = `Last updated: June 2026

These Terms of Service govern your use of the ADA app. By using ADA you agree to these terms.

1. WHAT ADA IS
ADA is a health-facility directory for newcomers in Northern Cyprus. We list pharmacies, clinics, hospitals, and dentists to help you find care. We are not a medical provider, insurer, or emergency service.

2. NOT MEDICAL ADVICE
Nothing in ADA constitutes medical advice. Always consult a qualified healthcare professional for medical decisions. In an emergency, call 112.

3. FACILITY INFORMATION
Facility details (hours, addresses, phone numbers) are provided by registered providers and may not always be current. Verify critical information directly with the facility before visiting.

4. ACCOUNTS
You are responsible for keeping your account credentials secure. Notify us immediately if you suspect unauthorised access.

5. PROVIDER ACCOUNTS
Providers are responsible for keeping their facility information accurate and up to date. Listing on ADA does not constitute an endorsement by us.

6. APPOINTMENTS
ADA facilitates appointment requests between customers and providers. We are not party to the appointment and bear no responsibility for missed, cancelled, or unsatisfactory appointments.

7. PROHIBITED USE
You may not use ADA to: submit false information, harass other users, attempt to gain unauthorised access, or use the app for any unlawful purpose.

8. LIMITATION OF LIABILITY
To the maximum extent permitted by law, ADA is provided "as is" without warranty of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the app.

9. GOVERNING LAW
These terms are governed by the laws of the Turkish Republic of Northern Cyprus (TRNC).

10. CONTACT
Questions about these terms: berke.ustun95@gmail.com`

export default function LegalScreen({ onBack, lang, initialTab = 'privacy' }) {
  const [tab, setTab] = useState(initialTab)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={s.backText}>{t('back', lang)}</Text>
          </TouchableOpacity>
          <Text style={s.title}>{tab === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}</Text>
          <View style={s.headerRight} />
        </View>

        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'privacy' && s.tabBtnActive]}
            onPress={() => setTab('privacy')}
          >
            <Text style={[s.tabText, tab === 'privacy' && s.tabTextActive]}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tab === 'terms' && s.tabBtnActive]}
            onPress={() => setTab('terms')}
          >
            <Text style={[s.tabText, tab === 'terms' && s.tabTextActive]}>Terms of Service</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
          <Text style={s.bodyText}>{tab === 'privacy' ? PRIVACY : TERMS}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  container:   { flex: 1, paddingHorizontal: 16 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 70 },
  backText:    { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  title:       { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, textAlign: 'center' },
  headerRight: { minWidth: 70 },
  tabRow:      { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, padding: 3, marginBottom: 20 },
  tabBtn:      { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabBtnActive:{ backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tabTextActive:{ fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  body:        { paddingBottom: 48 },
  bodyText:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 22 },
})
