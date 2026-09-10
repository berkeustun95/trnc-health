import { View, Text, Modal, Pressable, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { dormWaMessage, dormWebsiteUrl } from '../constants/dorms'
import { logContactEvent } from '../utils/logContactEvent'

// The room-type detail sheet, reached from the room list on DormPartnerScreen.
//
// A Modal, matching PickerSheet's idiom in AccommodationScreen — overlay dims and closes on
// tap, the inner Pressable stops that propagating, and it slides from the bottom.
//
// ⚠ WHY THIS NEEDS NO App.js STATE WHILE THE SHOWCASE OVERLAY DOES. That looks inconsistent
//   and is not. The showcase is a plain View rendered above the list, so Android hardware
//   back falls through to App.js's chain and the state has to live there to be checked in
//   the right order. A Modal is a real native window: `onRequestClose` fires on hardware
//   back and consumes it, so the sheet closes without App.js ever seeing the press. Local
//   state is correct here and would have been a bug there.
//
// ─── EMPTY-SAFE, LIKE EVERYTHING ELSE ───────────────────────────────────────
// Price, m² and availability are all owed by Özok. Each row collapses on its own, so today
// the sheet is a room name and two ways to ask about it — which is a complete thought, not
// a stub. It does not print a dash, an "unknown", or a greyed row.

// Availability is a BOOLEAN when known. If Özok's data turns out to be a COUNT this needs a
// different shape — check-dorms.mjs asserts the type so that surfaces here, not on device.
function availabilityLabel(available, lang) {
  if (available === true)  return t('dormRoomAvailable', lang)
  if (available === false) return t('dormRoomFull', lang)
  return null
}

// The body is split out and defined at MODULE SCOPE for two reasons. It lets the Modal stay
// mounted with `visible={false}` — PickerSheet's idiom — so the sheet animates OUT as well
// as in, which unmounting it would lose. And a component declared inside its parent is a
// new type on every render, which remounts its subtree.
// A cash plan as a LEFT-TO-RIGHT PAYMENT SEQUENCE, which is what it actually is:
// €500 kapora → €940 → €450 → €450 → €450.
//
// ⚠ THE SEQUENCE IS NEVER SUMMED. Alasia publishes the instalments and not their total;
//   adding them would be ADA's arithmetic. Reproduce, do not compute.
// ⚠ AND NO FIGURE STANDS ALONE — every one sits under its plan's own header, which is what
//   stops €2,490 being read as a total when it is a balance, or the reverse.
function CashPlan({ plan, lang, holding }) {
  return (
    <View style={s.plan}>
      <View style={s.planHead}>
        <Text style={s.planTitle}>{t(plan.labelKey, lang)}</Text>
        {/* The discount is Alasia's own string, in their own "%10" form. Not reformatted. */}
        {!!plan.discount && (
          <View style={s.discount}><Text style={s.discountText}>{plan.discount}</Text></View>
        )}
      </View>
      <View style={s.seq}>
        {!!holding?.amount && (
          <>
            <Text style={s.seqItem}>{holding.amount} <Text style={s.seqUnit}>{t('dormKapora', lang)}</Text></Text>
            <Ionicons name="chevron-forward" size={11} color={colors.textSecondary} />
          </>
        )}
        {plan.amounts.map((a, i) => (
          <View key={i} style={s.seqPair}>
            <Text style={s.seqItem}>{a}</Text>
            {i < plan.amounts.length - 1 && (
              <Ionicons name="chevron-forward" size={11} color={colors.textSecondary} />
            )}
          </View>
        ))}
      </View>
    </View>
  )
}

// A bank plan as MONTHLY CHIPS: "€385.83 × 6 ay".
//
// ⚠ months IS PER BANK — İşbank runs 6/8/10/12 and Ziraat 7/8/10/12. The chip pairs each
//   amount with ITS OWN month count by index, so the two can never be crossed.
function BankPlan({ plan, lang }) {
  return (
    <View style={s.plan}>
      <View style={s.planHead}>
        {/* A bank name is a proper noun and is not translated. */}
        <Text style={s.planTitle}>{plan.bankName}</Text>
      </View>
      <View style={s.chipWrap}>
        {plan.amounts.map((a, i) => (
          <View key={i} style={s.monthChip}>
            <Text style={s.monthChipText}>
              {a} <Text style={s.monthChipUnit}>
                {t('dormPlanMonthsShort', lang).replace('{n}', plan.months[i])}
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function SheetBody({ room, partner, lang, region, onClose, insets }) {
  const langCode = LANG_CODES[lang] || 'en'

  const waNum = String(partner.whatsapp || partner.phone || '').replace(/\D/g, '')
  const name  = t(room.nameKey, lang)

  // ⚠ THE ROOM NAME IN THE MESSAGE IS RESOLVED IN THE MESSAGE'S LANGUAGE, NOT THE USER'S.
  //   The desk reads Turkish or English; a Greek user's enquiry naming "Μπανγκαλόου, 2
  //   άτομα" is unactionable. constants/dorms.js takes { tr, en } for exactly this reason
  //   and stays free of any i18n import — resolving it is the screen's job.
  const roomByLocale = {
    tr: t(room.nameKey, 'Turkish'),
    en: t(room.nameKey, 'English'),
  }

  const rows = [
    { label: t('dormRoomSize', lang),         value: room.sqm != null ? `${room.sqm} m²` : null },
    { label: t('dormRoomAvailability', lang), value: availabilityLabel(room.available, lang) },
  ].filter(r => r.value != null)

  const p = room.plans || {}
  const cashPlans = [p.full, p.two, p.four].filter(Boolean)
  const bankPlans = [p.isbank, p.ziraat].filter(Boolean)
  const dep = partner.deposits || {}

  // ⚠ entity_id IS THE PARTNER, NOT THE ROOM. contact_events.entity_id is a uuid and rooms
  //   have no uuid — they have a short code the reception desk reads. Minting per-room uuids
  //   to make the counter finer-grained would add a dimension the table was not designed for
  //   and that nothing reports on. Which room was asked about travels in the WhatsApp Kod
  //   and in utm_content, where a human and the partner's own analytics can both see it.
  const openWhatsApp = () => {
    if (!waNum) return
    logContactEvent('accommodation', partner.id, 'whatsapp', region)
    Linking.openURL(`https://wa.me/${waNum}?text=${encodeURIComponent(dormWaMessage(partner, langCode, room.code, roomByLocale))}`)
      .catch(() => {})
  }

  // Requires 20261014_contact_events_website_action.sql — see the precondition on
  // DORMS_LIVE in constants/flags.js. Unapplied, the row is rejected and swallowed.
  const openWebsite = () => {
    const url = dormWebsiteUrl(partner, room.code)
    if (!url) return
    logContactEvent('accommodation', partner.id, 'website', region)
    Linking.openURL(url).catch(() => {})
  }

  return (
    <Pressable style={s.overlay} onPress={onClose}>
      {/* Swallows the tap so pressing inside the sheet does not close it. */}
      <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={2}>{name}</Text>
            {/* Alasia's OWN name for this room, verbatim and untranslated — it is the label
                attached to these figures on their prices page, and somebody comparing the
                two pages needs the word they will see there. */}
            {!!room.sourceName && (
              <Text style={s.sourceName} numberOfLines={1}>
                {t('dormListedAs', lang)}: {room.sourceName}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={t('cancel', lang)}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}>
          {rows.map(r => (
            <View key={r.label} style={s.row}>
              <Text style={s.rowLabel}>{r.label}</Text>
              <Text style={s.rowValue}>{r.value}</Text>
            </View>
          ))}

          {/* ─── PRICING ─────────────────────────────────────────────────────
              FIVE PLANS, EACH ITS OWN BLOCK, NEVER A TABLE. A table of five plans by up
              to five columns needs empty cells, and an empty cell has to be filled with a
              dash — which is a table artifact, not information Alasia published.

              The academic year sits at the top so a stale table is visibly stale rather
              than silently wrong. */}
          {(cashPlans.length > 0 || bankPlans.length > 0) && (
            <>
              <Text style={s.yearLabel}>
                {t('dormAcademicYear', lang)} {partner.academicYear}
              </Text>

              {cashPlans.map(pl => (
                <CashPlan key={pl.labelKey} plan={pl} lang={lang} holding={dep.holding} />
              ))}
              {bankPlans.map(pl => (
                <BankPlan key={pl.bankName} plan={pl} lang={lang} />
              ))}

              {/* DEPOSITS ARE ALWAYS VISIBLE and never inside a collapse. Both notes
                  travel with the numbers — without them the prices are misleading. */}
              <View style={s.notes}>
                {!!dep.holding?.noteKey && (
                  <Text style={s.note}>{t(dep.holding.noteKey, lang)}</Text>
                )}
                {/* ⚠ THE SECURITY DEPOSIT AMOUNT IS OMITTED ON PURPOSE — Alasia's EN page
                    says ₺8,000 and their TR page says €8,000, ~€180 vs €8,000. The FACT is
                    reproduced, the AMOUNT is not, and their page is linked. Do not "fix"
                    this by filling in the likelier figure. */}
                {!!dep.security?.noteKey && (
                  <Text style={s.note}>{t(dep.security.noteKey, lang)}</Text>
                )}
              </View>

              {!!partner.priceSource?.url && (
                <TouchableOpacity style={s.sourceLink} activeOpacity={0.6}
                  onPress={() => Linking.openURL(partner.priceSource.url).catch(() => {})}>
                  <Ionicons name="open-outline" size={13} color={colors.primary} />
                  <Text style={s.sourceLinkText}>alasiadorm.com/prices</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>

        {!!waNum && (
          <TouchableOpacity style={s.waBtn} onPress={openWhatsApp} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.btnText}>{t('dormRoomEnquire', lang)}</Text>
          </TouchableOpacity>
        )}
        {!!partner.website && (
          <TouchableOpacity style={s.siteBtn} onPress={openWebsite} activeOpacity={0.85}>
            <Ionicons name="open-outline" size={17} color={colors.primary} />
            <Text style={s.siteBtnText}>{t('dormWebsite', lang)}</Text>
          </TouchableOpacity>
        )}
    </Pressable>
    </Pressable>
  )
}

// `visible` is derived from the room rather than carried as a separate boolean, so the two
// cannot disagree — a visible sheet with no room is not a reachable state.
export default function DormRoomSheet({ room, partner, lang, region = null, onClose }) {
  const insets = useSafeAreaInsets()
  const visible = !!room && !!partner
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {visible && (
        <SheetBody room={room} partner={partner} lang={lang} region={region}
          onClose={onClose} insets={insets} />
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  title:    { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  sourceName: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },
  // The sheet scrolls: five plans plus the deposit notes do not fit a fixed height on a
  // small screen, and capping it here is what stops the buttons being pushed off.
  scroll:   { maxHeight: 440 },
  scrollContent: { paddingBottom: 4 },
  yearLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary,
               textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 8 },
  plan:     { backgroundColor: colors.cardBg, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  planTitle:{ flex: 1, fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  discount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.successLight },
  discountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.success },
  seq:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  seqPair:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  seqItem:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  seqUnit:  { fontFamily: 'Inter_400Regular', color: colors.textSecondary, fontSize: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthChip:{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.surface },
  monthChipText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  monthChipUnit: { fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  notes:    { marginTop: 6, marginBottom: 4, gap: 4 },
  note:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 17 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  sourceLinkText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  rowValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  waBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18,
              paddingVertical: 14, borderRadius: radius.md, backgroundColor: '#25D366' },
  btnText:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  siteBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10,
              paddingVertical: 13, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
              backgroundColor: 'transparent' },
  siteBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
})
