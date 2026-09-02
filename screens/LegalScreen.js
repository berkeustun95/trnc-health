import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'

const PRIVACY = `Last updated: August 2026

ADA ("we", "our", "the app") is a directory and services app for residents of and newcomers to Northern Cyprus (TRNC) — healthcare facilities and duty pharmacies, local places and points of interest, events, accommodation, vehicle services and roadside assistance, and other local services. This policy explains what data we collect, why, and how we protect it.

1. DATA WE COLLECT
• Account data: email address, password (hashed by Supabase Auth — we never see it), and your account role.
• Profile data. Each field is listed with what it is for. Where a field is marked "not used yet", that is literal: we collect it for the stated purpose and nothing in the app reads it today.
  · First and last name — your real name. Held on your account; see section 2 for who can see it.
  · Display name — a name you choose, 3 to 20 characters. It does not have to be your real name. This is the name shown next to reviews and questions you post, and it is the only name other users see. Not used yet — no part of the app displays it today.
  · Date of birth — to confirm you are 13 or over. This is checked when you enter it and the account cannot be completed without it. We also intend to use it to keep age-restricted features and content away from accounts that should not see them; that second use is not built yet.
  · Nationality — so that we can tell which residency, permit and paperwork information applies to you, and which languages to offer first. Not used yet — nothing in the app reads it.
  · Phone number — held on your account so that we can contact you about your account. It is not shown to other users and is not given to providers. Not used yet — nothing in the app reads it, and we have not contacted anyone using it.
  · Region within the TRNC — so that listings, duty pharmacy rotas and search results can be ordered for where you live rather than only for where your phone happens to be. Not used yet — nothing in the app reads it.
  · Resident status — student, working here, newly arrived, resident, or visiting — and, if you are a student, your study level and, for university and postgraduate study, your institution. This is intended to decide which parts of ADA are put in front of you, because someone who has just arrived needs different things from someone who has lived here ten years. Not used yet — nothing in the app reads it.
  · Preferred language — to show the app, and the notifications we send you, in your language.
• Profile picture: optional. Either a preset avatar you choose, or an image you upload, which is stored in our file storage.
• Push notification token: stored to send you duty pharmacy alerts and replies to questions you have asked. You can disable this in your device settings at any time.
• Reviews and questions you submit.
• Moderation data: content you report, and users you block. Your block list is private and is never shown to the user you blocked.
• Rejected submissions: if text you submit is rejected by our content filter, we keep a record of it, linked to your account, for 30 days. Section 5 describes it in full.
• Usage data: we do not use analytics SDKs or third-party trackers.

2. WHAT IS PUBLIC AND WHAT IS NOT
Most of what we ask for is never seen by anyone but you.

Other users can see:
• Your display name, next to reviews, questions and answers you post.
• The content of the reviews, questions and answers you post, and the ratings you give.

Other users cannot see: your first and last name, your date of birth, your nationality, your phone number, your region, your resident status, your study level or institution, or your email address.

Providers are not shown any of your personal data. When you ask a question on a facility's page, the provider sees the question and your display name — not your real name, your date of birth, your phone number, your region or your resident status.

Our administrators can see the data on your account. This is necessary to operate the service, investigate reports, and respond to your requests.

3. HOW WE USE YOUR DATA
• To operate the app: show you relevant facilities and send notifications.
• To personalise your experience: display content in your preferred language.
• To screen text you post against our list of prohibited terms, so that abusive content does not reach other users.
• To review submissions the filter rejected, so that we can find rejections that were wrong and correct them.
• We do not sell, rent, or share your personal data with third parties for marketing.

4. DATA STORAGE
All data is stored on Supabase (EU region). Row-Level Security (RLS) policies ensure you can only access your own records. Your data is never visible to other customers.

5. DATA RETENTION
Different data is kept for different lengths of time.

Your account: we retain the data on your account for as long as your account is active. If you request account deletion, we will delete your personal data within 30 days, except where retention is required by applicable law.

Rejected submissions — 30 days: if a submission is rejected by our content filter, we keep the rejected text, the term that triggered the rejection, and the time it happened, so that we can find and correct rejections that were wrong and improve the filter. These records are linked to your account, are visible only to our administrators, are deleted automatically after 30 days, and are not used for any other purpose.

Content we have removed: content removed for breaching our community standards is retained internally so that we can identify repeat breaches by the same account. It is no longer visible to other users.

6. YOUR RIGHTS
You can see and correct the data on your account in your profile settings at any time. You may request deletion of your account and all associated data at any time by emailing us. We will process deletion within 30 days.

7. AGE AND CHILDREN
ADA is for people aged 13 and over, and is not directed at children under 13.

When you set up your profile we ask for your date of birth. If the date you enter shows that you are under 13, we do not store that date. We record only that the account is not eligible, and the account cannot be used.

If you believe a child under 13 has provided us with personal data, please contact us and we will delete it promptly.

8. CHANGES
We may update this policy. Continued use of the app after changes means you accept the updated policy.

9. CONTACT
For privacy questions or deletion requests: getadaapp@gmail.com`

const TERMS = `Last updated: August 2026

These Terms of Service govern your use of the ADA app. By creating an account or using ADA you agree to these terms. If you do not agree, do not use the app.

1. WHAT ADA IS
ADA is a directory and services app for residents of and newcomers to Northern Cyprus (TRNC). It includes listings and tools covering healthcare facilities and duty pharmacies, local places and points of interest, events, accommodation, vehicle services and roadside assistance, and other local services. Features vary by region and may change over time.

ADA is not a medical provider, insurer, telehealth service, emergency service, estate agent, travel agent, or employer. We connect you with third parties; we are not a party to any transaction, booking, or agreement you enter into with them.

2. NOT MEDICAL ADVICE
Some of what ADA lists is health-related — pharmacies, clinics, hospitals, and dentists. Nothing in ADA constitutes medical advice, diagnosis, or treatment. Facility listings, opening hours, and other information are provided for reference only. Always consult a qualified healthcare professional for medical decisions. In an emergency, call 112.

3. FACILITY INFORMATION
Facility details — including hours, addresses, phone numbers, and services — are provided by registered providers and may not always be current or complete. Verify critical information directly with the facility before visiting.

4. ACCOUNTS
You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately at getadaapp@gmail.com if you suspect unauthorised access to your account.

4.1 MINIMUM AGE
You must be at least 13 years old to create an ADA account. By creating an account you confirm that you are 13 or older. Some parts of ADA can be browsed without an account.

If we become aware that an account has been created by someone under 13, we will close it and delete the associated personal data.

5. PROVIDER ACCOUNTS
Providers are responsible for keeping their facility information accurate and up to date. Listing on ADA does not constitute an endorsement by us. We reserve the right to suspend or remove any listing that contains inaccurate, misleading, or inappropriate content.

6. PROHIBITED USE
You may not use ADA to:
• Submit false, misleading, or fraudulent information.
• Harass, abuse, or harm other users or providers.
• Attempt to gain unauthorised access to any part of the app or its infrastructure.
• Scrape, copy, or redistribute app content without permission.
• Use the app for any unlawful purpose under TRNC or applicable law.

7. USER CONTENT AND COMMUNITY STANDARDS
ADA lets you post content — including reviews, questions, answers, and in some parts of the app listings and other submissions. You are solely responsible for the content you post, and you must have the right to post it.

7.1 ZERO TOLERANCE FOR OBJECTIONABLE CONTENT
There is ZERO TOLERANCE for objectionable content and abusive users. You may not post content that:
• Is unlawful, defamatory, fraudulent, or misleading.
• Harasses, threatens, bullies, or intimidates any person.
• Promotes hatred against, or discrimination towards, any person or group on the basis of race, ethnicity, national origin, religion, disability, sex, gender identity, sexual orientation, or age.
• Is sexually explicit, or sexualises any person.
• Depicts, promotes, or glorifies violence, self-harm, or illegal activity.
• Impersonates another person, a business, a public authority, or ADA itself.
• Discloses another person's private information without their consent.
• Is spam, or solicits payment or contact outside the app in order to avoid these rules.

This list is illustrative, not exhaustive. Content that is not listed here may still be removed if it breaches the spirit of these standards.

7.2 CONTENT FILTERING
Text you submit in reviews, questions, answers, facility and place listings, and listing change requests is automatically screened at the moment you submit it against a list of prohibited terms, currently maintained in English and Turkish.

Automated screening is a first line of defence only. It does not cover every type of content or every language, and no automated filter catches everything. The reporting and blocking tools described below apply to all user content, whether or not it was automatically screened.

If a submission is rejected by this screening, we keep the rejected text, the term that triggered the rejection, and the time it happened, so that we can find and correct rejections that were wrong and improve the filter. These records are linked to your account, are visible only to our administrators, are deleted automatically after 30 days, and are not used for any other purpose.

7.3 REPORTING OBJECTIONABLE CONTENT
Every review, question, and answer in ADA carries a Report action. Open the menu on the item you want to report, choose a reason, and submit it — you do not need to contact us separately, and the author is not told who reported them.

We review reported content and remove content that breaches these standards within 24 hours of the report.

Content reported by several independent users may be hidden automatically, pending our review, before a person has looked at it. Automatic hiding is a safeguard and not a finding against the author; content hidden this way can be restored if our review finds no breach.

Content we remove is retained internally so that we can identify repeat breaches by the same account. It is no longer visible to other users.

7.4 BLOCKING ANOTHER USER
You can block another user from any review they have posted. Blocking hides that user's reviews and comments from you wherever community content appears. Blocking is private: the blocked user is not notified and cannot tell that you have blocked them. You can see and reverse your blocks at any time in your profile settings.

7.5 CONSEQUENCES OF BREACHING THESE STANDARDS
If you breach these standards we may, at our discretion and depending on severity: remove the content; temporarily suspend your ability to post reviews, questions, and answers; or permanently terminate your account and your access to ADA. Where a breach is serious, we may act without prior notice.

7.6 CONTACTING US ABOUT CONTENT
To report objectionable content, an abusive user, or a decision we have taken, contact us at getadaapp@gmail.com. We aim to respond within 24 hours.

8. INTELLECTUAL PROPERTY
All content, design, and code in ADA is owned by or licensed to us. You may not reproduce, distribute, or create derivative works without our written permission.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, ADA is provided "as is" without warranty of any kind, express or implied. We are not liable for any indirect, incidental, special, or consequential damages arising from your use of or inability to use the app, including but not limited to damages resulting from reliance on facility information.

10. TERMINATION
We reserve the right to suspend or terminate your account at any time if you breach these terms or if we determine, in our sole discretion, that your use of the app is harmful to other users or to ADA.

11. CHANGES TO THESE TERMS
We may update these terms from time to time. Continued use of the app after changes constitutes acceptance of the updated terms. The "Last updated" date above always reflects the current version.

12. GOVERNING LAW AND LANGUAGE
These terms are governed by the laws of the Turkish Republic of Northern Cyprus (TRNC).

These terms are published in English. If we make a translation available for convenience, the English version governs in the event of any inconsistency.

13. CONTACT
Questions about these terms, or to report objectionable content? Contact us at getadaapp@gmail.com.`

export default function LegalScreen({ onBack, lang, initialTab = 'privacy' }) {
  const [tab, setTab] = useState(initialTab)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.container}>
        <View style={s.header}>
          <BackButton lang={lang} onPress={onBack} style={s.backBtn} />
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
