import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import ContentReportMenu from '../components/ContentReportMenu'
import Avatar from '../components/Avatar'
import { STUDENT_LEVEL_LABEL_KEY } from '../constants/profileGate'
import { colors, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── The student profile page (slice 5) ─────────────────────────────────────
//
// The SECOND surface where one customer's data reaches another, and it renders EXACTLY
// what get_student_profile returns: eight columns, one row per enrolment. There is no
// other source, and nothing here reads `profiles` — a direct read would return zero rows
// anyway, because RLS is the boundary and the RPC is the only way across it.
//
// NO FREE-TEXT BIO, and that is a product decision rather than an omission: free text
// from strangers is a moderation surface, and every field on this page is structured and
// comes from a vocabulary the database constrains.
//
// BLOCK LIVES HERE NOW (slice 6). Blocks have existed since 20260712 and both student
// RPCs have always honoured them in both directions, but until 20261029 the only way to
// CREATE one was the review flow — you had to find something somebody wrote. block_user()
// takes a person, and this page is where a person is.
//
// ► AND THERE IS NO "LEAVE" ANYWHERE ON THIS PAGE, because leave is a property of a
//   CONVERSATION, not of a person. The only way to stop somebody from here is to block
//   them, which is the correct and stronger verb. See ConversationScreen for the place
//   where both exist and how they are kept apart.
//
// ⚠ TWO RULES FOR WHOEVER ADDS THE FIRST WRITE PATH HERE. This screen READS ONLY, so it
//   breaks neither — but the next person to touch student_education from the app needs
//   them, and a rule that lives only in a migration comment is a rule nobody reads:
//     1. Set mirror_owned = false on EVERY row the app writes or updates. That makes the
//        flag mean exactly "never touched by the new app", which is what stops the
//        transition trigger (20261026) from ever overwriting something a person edited.
//     2. Leave the five profiles affiliation columns UNTOUCHED — not written, and NOT
//        nulled. Nulling institution_id is a genuine change, so it fires the trigger's
//        unlist branch and drops the user from every list. Stale-but-unwritten is safe
//        until the drop migration runs.
//
// THE CLIENT DOES NOT RE-DERIVE RECIPROCITY. can_see_student_lists() is the one rule, it
// lives in the database, and this screen simply calls the RPC and handles NOT_LISTED.
// A second copy of that rule on the client is a second thing to drift, and the copy that
// drifts is the one that lets somebody lurk.

function Enrolment({ row, lang }) {
  const current = row.study_end_year == null
  const levelKey = STUDENT_LEVEL_LABEL_KEY[row.level]
  // `level` arrives RAW from SQL ('university' / 'postgraduate') because there is no
  // level_i18n table and inventing one to render two words would be a schema for a label.
  // An unknown value renders nothing rather than the raw token: a vocabulary widened in
  // the database before the app ships a key must not surface 'vocational' to a user.
  const years = row.study_start_year
    ? `${row.study_start_year} – ${row.study_end_year ?? t('studentListPresent', lang)}`
    : row.study_end_year
      ? String(row.study_end_year)
      : null
  const meta = [levelKey ? t(levelKey, lang) : null, row.subject_name, years].filter(Boolean).join(' · ')

  return (
    <View style={s.enrolRow}>
      <View style={[s.enrolDot, current && s.enrolDotCurrent]} />
      <View style={s.enrolBody}>
        <Text style={s.enrolUni} numberOfLines={2}>{row.institution_name}</Text>
        {meta ? <Text style={s.enrolMeta}>{meta}</Text> : null}
      </View>
      <Text style={[s.enrolStatus, !current && s.enrolStatusAlumni]}>
        {t(current ? 'studentListCurrent' : 'studentListAlumni', lang)}
      </Text>
    </View>
  )
}

export default function StudentProfileScreen({ userId, lang, isMe = false, onBack, onMessage }) {
  // rows: null = not read yet · [] = nothing visible · [...] = the history
  const [rows, setRows]   = useState(null)
  const [error, setError] = useState(null)   // null | 'gone' | 'load'

  const load = useCallback(() => {
    setError(null)
    setRows(null)
    let cancelled = false
    supabase
      .rpc('get_student_profile', { p_user_id: userId, p_lang: lang })
      .then(({ data, error: err }) => {
        if (cancelled) return
        // AUTH_REQUIRED and NOT_LISTED are the server restating what the client already
        // believed — you cannot reach this page without passing both — so they are a
        // load failure here, not a state worth its own copy. The raw message never
        // reaches the user either way.
        if (err) { setError('load'); return }
        setRows(data ?? [])
      })
    return () => { cancelled = true }
  }, [userId, lang])

  useEffect(() => load(), [load])

  const header = rows?.[0] ?? null

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('studentProfileTitle', lang)} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {error === 'load' ? (
          <ContentCard>
            <Text style={s.empty}>{t('studentLoadError', lang)}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.85} accessibilityRole="button">
              <Ionicons name="refresh" size={17} color={colors.surface} />
              <Text style={s.retryText}>{t('tryAgain', lang)}</Text>
            </TouchableOpacity>
          </ContentCard>
        ) : rows === null ? (
          <ContentCard><ActivityIndicator color={colors.primary} /></ContentCard>
        ) : rows.length === 0 ? (
          // ZERO ROWS IS NOT AN ERROR AND MUST NOT READ AS ONE. It means the person opted
          // out between the tap and the load, or one of the two has blocked the other, or
          // they are no longer listed. The RPC returns the same empty result for every one
          // of those on purpose — distinct messages would make this page an oracle for
          // "you are blocked" — so the copy says the only true thing: it is not there now.
          <ContentCard><Text style={s.empty}>{t('studentProfileUnavailable', lang)}</Text></ContentCard>
        ) : (
          <>
            <ContentCard>
              <View style={s.headRow}>
                <Avatar
                  avatarUrl={header.avatar_url}
                  initials={header.display_name?.[0]?.toUpperCase() ?? '?'}
                  size={64}
                  textSize={24}
                />

                <View style={s.headBody}>
                  <Text style={s.name} numberOfLines={2}>{header.display_name}</Text>
                  {isMe ? (
                    <View style={s.youPill}><Text style={s.youText}>{t('studentListYou', lang)}</Text></View>
                  ) : null}
                </View>

                {/* Reporting yourself is meaningless, so the menu is hidden on your own
                    page — the same rule the student list row already applies. */}
                {isMe ? null : (
                  <ContentReportMenu
                    contentType="profile"
                    contentId={userId}
                    lang={lang}
                    blockUserId={userId}
                    onBlocked={onBack}
                  />
                )}
              </View>
              {/* ► THE REFUSAL IS THE SERVER'S, NOT THIS BUTTON'S. The button is shown to
                  everyone the page is shown to, and start_conversation answers. Hiding it
                  for people who cannot be messaged would BE the oracle the generic refusal
                  exists to prevent: an adult would learn a stranger is under 18 by noticing
                  the button was missing. It is better to offer it and be refused. */}
              {isMe || !onMessage ? null : (
                <TouchableOpacity
                  style={s.messageBtn}
                  onPress={() => onMessage({ userId, displayName: header.display_name })}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Ionicons name="chatbubble-outline" size={17} color={colors.surface} />
                  <Text style={s.messageBtnText}>{t('msgSendMessage', lang)}</Text>
                </TouchableOpacity>
              )}
            </ContentCard>

            {/* ► THE HEADING IS INSIDE THE CARD. It used to sit above it, directly on
                PageBackground's photo, where textSecondary grey under a 0.30 scrim is
                barely readable — this is the "EĞİTİM" bug. Every section label in ADA
                that reads correctly is inside a ContentCard; NewcomerEssentialsScreen
                is the pattern this follows. */}
            <View style={s.historyWrap}>
              <ContentCard>
                <Text style={s.sectionTitle}>{t('studentProfileHistory', lang)}</Text>
                {rows.map((row, i) => (
                  <View key={`${row.institution_name}-${row.level}`} style={i ? s.divider : null}>
                    <Enrolment row={row} lang={lang} />
                  </View>
                ))}
              </ContentCard>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg },
  scroll:  { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },

  empty:     { fontSize: 14, color: colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  retryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
               marginTop: 14, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11 },
  retryText: { color: colors.surface, fontSize: 14, fontWeight: '700' },

  headRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headBody:  { flex: 1, gap: 6 },
  name:      { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  youPill:   { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.sm,
               paddingHorizontal: 8, paddingVertical: 2 },
  // primaryDark, not primary: `primary` on `primaryLight` is 4.44:1 and scrapes AA,
  // and this pill sits over a PageBackground photo where it reads washed out. The
  // theme carries primaryDark (6.71:1) for exactly this pairing.
  youText:   { fontSize: 11, fontWeight: '700', color: colors.primaryDark },

  messageBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    marginTop: 16, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12 },
  messageBtnText: { color: colors.surface, fontSize: 15, fontWeight: '700' },

  historyWrap:  { marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary,
                  textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },

  divider:   { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 12, paddingTop: 12 },
  enrolRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  enrolDot:  { width: 9, height: 9, borderRadius: 5, marginTop: 5, backgroundColor: colors.border },
  enrolDotCurrent: { backgroundColor: colors.primary },
  enrolBody: { flex: 1, gap: 3 },
  enrolUni:  { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  enrolMeta: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  enrolStatus:       { fontSize: 11, fontWeight: '700', color: colors.primary, marginTop: 3 },
  enrolStatusAlumni: { color: colors.textSecondary },
})
