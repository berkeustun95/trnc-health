import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, ScrollView,
  TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

const { width: SCREEN_W } = Dimensions.get('window')
const DESC_LIMIT = 500

function statusStyle(status) {
  if (status === 'approved') return { bg: colors.successLight, text: colors.success }
  if (status === 'rejected') return { bg: colors.dangerLight, text: colors.danger }
  if (status === 'pending')  return { bg: '#FFF7ED', text: '#C2410C' }
  return { bg: colors.bg, text: colors.textSecondary }
}

function statusLabel(status, lang) {
  if (status === 'approved') return t('eventStatusApproved', lang)
  if (status === 'rejected') return t('eventStatusRejected', lang)
  if (status === 'pending')  return t('eventStatusPending', lang)
  return t('eventStatusDraft', lang)
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Event Card ──────────────────────────────────────────────────────────────

function OrgEventCard({ event, onEdit, lang }) {
  const img = event.images?.[0]
  const ss = statusStyle(event.status)

  return (
    <TouchableOpacity style={s.card} onPress={() => onEdit(event)} activeOpacity={0.85}>
      {img ? (
        <Image source={{ uri: img }} style={s.cardThumb} resizeMode="cover" />
      ) : (
        <View style={[s.cardThumb, s.cardThumbFallback]}>
          <Ionicons name="calendar-outline" size={28} color={colors.border} />
        </View>
      )}
      <View style={s.cardInfo}>
        <Text style={s.cardTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={s.cardDate} numberOfLines={1}>{formatDate(event.start_date)}</Text>
        {event.location ? (
          <Text style={s.cardLoc} numberOfLines={1}>{event.location}</Text>
        ) : null}
        <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
          <Text style={[s.statusPillText, { color: ss.text }]}>{statusLabel(event.status, lang)}</Text>
        </View>
        {event.status === 'rejected' && event.rejection_reason ? (
          <Text style={s.rejectedReason} numberOfLines={2}>
            {t('eventRejectedReason', lang).replace('{reason}', event.rejection_reason)}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.border} />
    </TouchableOpacity>
  )
}

// ─── Image Strip ─────────────────────────────────────────────────────────────

function ImageStrip({ images, onAdd, onRemove, uploading }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.imageStrip}
    >
      {images.map((uri, i) => (
        <View key={i} style={s.imageThumbWrap}>
          <Image source={{ uri }} style={s.imageThumb} resizeMode="cover" />
          <TouchableOpacity style={s.imageRemoveBtn} onPress={() => onRemove(i)}>
            <Ionicons name="close-circle" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      ))}
      {images.length < 6 && (
        <TouchableOpacity style={s.imageAddBtn} onPress={onAdd} disabled={uploading}>
          {uploading
            ? <ActivityIndicator color={colors.primary} />
            : <>
                <Ionicons name="add" size={24} color={colors.primary} />
                <Text style={s.imageAddText}>Add</Text>
              </>
          }
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// ─── Event Form Modal ─────────────────────────────────────────────────────────

function EventFormModal({ visible, event, session, lang, onSave, onClose }) {
  const isNew = !event

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [location, setLocation] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [images, setImages] = useState([])
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activePicker, setActivePicker] = useState(null) // 'start' | 'end' | null

  useEffect(() => {
    if (visible) {
      setTitle(event?.title ?? '')
      setDesc(event?.description ?? '')
      setOrganizerName(event?.organizer_name ?? '')
      setLocation(event?.location ?? '')
      setLocationUrl(event?.location_url ?? '')
      setImages(event?.images ?? [])
      setStartDate(event?.start_date ? new Date(event.start_date) : null)
      setEndDate(event?.end_date ? new Date(event.end_date) : null)
    }
  }, [visible, event])

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: false,
    })
    if (res.canceled || !res.assets?.length) return
    const asset = res.assets[0]
    setUploading(true)
    try {
      const ext = asset.uri.split('.').pop()
      const path = `events/${session.user.id}/${Date.now()}.${ext}`
      const resp = await fetch(asset.uri)
      const blob = await resp.blob()
      const { error } = await supabase.storage.from('event-images').upload(path, blob, { contentType: `image/${ext}` })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('event-images').getPublicUrl(path)
      setImages(prev => [...prev, publicUrl])
    } catch {
      Alert.alert('Upload failed', 'Could not upload image. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(asDraft) {
    if (!title.trim()) { Alert.alert('', 'Please add an event title.'); return }
    if (!startDate) { Alert.alert('', 'Please set a start date.'); return }
    if (!organizerName.trim()) { Alert.alert('', 'Please enter an organiser name.'); return }

    setSaving(true)
    const payload = {
      organizer_id:   session.user.id,
      organizer_name: organizerName.trim(),
      title:          title.trim(),
      description:    desc.trim() || null,
      images,
      start_date:     startDate.toISOString(),
      end_date:       endDate?.toISOString() ?? null,
      location:       location.trim() || null,
      location_url:   locationUrl.trim() || null,
      status:         asDraft ? 'draft' : 'pending',
    }

    let error
    if (isNew) {
      ;({ error } = await supabase.from('events').insert(payload))
    } else {
      ;({ error } = await supabase.from('events').update(payload).eq('id', event.id))
    }
    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    onSave()
  }

  async function handleDelete() {
    Alert.alert(t('deleteEvent', lang), t('deleteEventConfirm', lang), [
      { text: t('cancel', lang), style: 'cancel' },
      {
        text: t('deleteEvent', lang), style: 'destructive',
        onPress: async () => {
          await supabase.from('events').delete().eq('id', event.id)
          onSave()
        },
      },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>{isNew ? t('createEvent', lang) : t('editEvent', lang)}</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={s.formContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Organiser name */}
            <Text style={s.fieldLabel}>{t('eventOrganizerName', lang)} *</Text>
            <TextInput
              style={s.input}
              value={organizerName}
              onChangeText={setOrganizerName}
              placeholder={t('eventOrganizerHint', lang)}
              placeholderTextColor={colors.textSecondary}
              maxLength={100}
            />

            {/* Title */}
            <Text style={s.fieldLabel}>{t('eventTitle', lang)} *</Text>
            <TextInput
              style={s.input}
              value={title}
              onChangeText={setTitle}
              placeholder={t('eventTitleHint', lang)}
              placeholderTextColor={colors.textSecondary}
              maxLength={120}
            />

            {/* Description */}
            <View style={s.fieldLabelRow}>
              <Text style={s.fieldLabel}>{t('eventDesc', lang)}</Text>
              <Text style={[s.charCount, desc.length > DESC_LIMIT * 0.9 && s.charCountWarn]}>
                {desc.length}/{DESC_LIMIT}
              </Text>
            </View>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={desc}
              onChangeText={v => setDesc(v.slice(0, DESC_LIMIT))}
              placeholder={t('eventDescHint', lang)}
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
            />

            {/* Start date */}
            <Text style={s.fieldLabel}>{t('eventStart', lang)} *</Text>
            <TouchableOpacity style={s.dateBtn} onPress={() => setActivePicker('start')}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={[s.dateBtnText, !startDate && s.datePlaceholder]}>
                {startDate ? formatDate(startDate.toISOString()) : 'Select start date & time'}
              </Text>
            </TouchableOpacity>

            {/* End date */}
            <Text style={s.fieldLabel}>{t('eventEnd', lang)}</Text>
            <TouchableOpacity style={s.dateBtn} onPress={() => setActivePicker('end')}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={[s.dateBtnText, !endDate && s.datePlaceholder]}>
                {endDate ? formatDate(endDate.toISOString()) : 'Select end date & time'}
              </Text>
              {endDate ? (
                <TouchableOpacity onPress={() => setEndDate(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>

            {/* Location */}
            <Text style={s.fieldLabel}>{t('eventLoc', lang)}</Text>
            <TextInput
              style={s.input}
              value={location}
              onChangeText={setLocation}
              placeholder={t('eventLocHint', lang)}
              placeholderTextColor={colors.textSecondary}
              maxLength={150}
            />

            {/* Location URL */}
            <Text style={s.fieldLabel}>{t('eventLocUrl', lang)}</Text>
            <TextInput
              style={s.input}
              value={locationUrl}
              onChangeText={setLocationUrl}
              placeholder="https://maps.google.com/..."
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={500}
            />

            {/* Photos */}
            <Text style={s.fieldLabel}>{t('addPhotos', lang)} (max 6)</Text>
            <ImageStrip
              images={images}
              onAdd={pickImage}
              onRemove={i => setImages(prev => prev.filter((_, idx) => idx !== i))}
              uploading={uploading}
            />

            {/* Actions */}
            <View style={s.formActions}>
              <TouchableOpacity
                style={[s.primaryBtn, saving && s.primaryBtnDisabled]}
                onPress={() => handleSave(false)}
                disabled={saving || uploading}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.primaryBtnText}>{t('submitEvent', lang)}</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity
                style={s.ghostBtn}
                onPress={() => handleSave(true)}
                disabled={saving || uploading}
              >
                <Text style={s.ghostBtnText}>{t('saveDraft', lang)}</Text>
              </TouchableOpacity>

              {!isNew && (
                <TouchableOpacity style={s.dangerBtn} onPress={handleDelete}>
                  <Feather name="trash-2" size={16} color={colors.danger} />
                  <Text style={s.dangerBtnText}>{t('deleteEvent', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {activePicker !== null && (
          <Modal transparent animationType="fade" onRequestClose={() => setActivePicker(null)}>
            <TouchableOpacity style={s.pickerBackdrop} activeOpacity={1} onPress={() => setActivePicker(null)} />
            <View style={s.pickerSheet}>
              <View style={s.pickerSheetHeader}>
                <Text style={s.pickerSheetTitle}>
                  {activePicker === 'start' ? t('eventStart', lang) : t('eventEnd', lang)}
                </Text>
                <TouchableOpacity onPress={() => setActivePicker(null)}>
                  <Text style={s.pickerDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={activePicker === 'start' ? (startDate ?? new Date()) : (endDate ?? startDate ?? new Date())}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={activePicker === 'end' && startDate ? startDate : new Date()}
                onChange={(_, date) => {
                  if (!date) return
                  if (activePicker === 'start') setStartDate(date)
                  else setEndDate(date)
                  if (Platform.OS === 'android') setActivePicker(null)
                }}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
          </Modal>
        )}
      </SafeAreaView>
    </Modal>
  )
}

// ─── Main Organizer Screen ────────────────────────────────────────────────────

export default function OrganizerScreen({ session, lang }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [formVisible, setFormVisible] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('events')
      .select('id, title, description, images, start_date, end_date, location, location_url, organizer_name, status, rejection_reason')
      .eq('organizer_id', session.user.id)
      .order('created_at', { ascending: false })
    setEvents(data ?? [])
    setLoading(false)
  }, [session.user.id])

  useEffect(() => { load() }, [load])

  function openCreate() { setEditingEvent(null); setFormVisible(true) }
  function openEdit(ev) { setEditingEvent(ev); setFormVisible(true) }
  function handleSaved() { setFormVisible(false); load() }

  const published  = events.filter(e => e.status === 'approved')
  const inReview   = events.filter(e => e.status === 'pending')
  const drafts     = events.filter(e => e.status === 'draft')
  const rejected   = events.filter(e => e.status === 'rejected')

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.headerIconWrap}>
            <Ionicons name="calendar" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={s.headerTitle}>{t('myEvents', lang)}</Text>
            <Text style={s.headerSub}>Event organiser</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => supabase.auth.signOut()} style={s.signOutBtn}>
          <Text style={s.signOutText}>{t('signOut', lang)}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={e => e.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.listContent, events.length === 0 && s.listEmpty]}
          ListHeaderComponent={
            events.length > 0 ? (
              <View style={s.statsRow}>
                <View style={s.statPill}>
                  <Text style={[s.statNum, { color: colors.success }]}>{published.length}</Text>
                  <Text style={s.statLabel}>{t('eventStatusApproved', lang)}</Text>
                </View>
                <View style={s.statPill}>
                  <Text style={[s.statNum, { color: '#C2410C' }]}>{inReview.length}</Text>
                  <Text style={s.statLabel}>{t('eventStatusPending', lang)}</Text>
                </View>
                <View style={s.statPill}>
                  <Text style={s.statNum}>{drafts.length}</Text>
                  <Text style={s.statLabel}>{t('eventStatusDraft', lang)}</Text>
                </View>
                {rejected.length > 0 && (
                  <View style={s.statPill}>
                    <Text style={[s.statNum, { color: colors.danger }]}>{rejected.length}</Text>
                    <Text style={s.statLabel}>{t('eventStatusRejected', lang)}</Text>
                  </View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Ionicons name="calendar-outline" size={56} color={colors.border} style={{ marginBottom: 16 }} />
              <Text style={s.emptyTitle}>{t('noOrgEvents', lang)}</Text>
              <Text style={s.emptyBody}>{t('createFirstEvent', lang)}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <OrgEventCard event={item} onEdit={openEdit} lang={lang} />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={openCreate} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      <EventFormModal
        visible={formVisible}
        event={editingEvent}
        session={session}
        lang={lang}
        onSave={handleSaved}
        onClose={() => setFormVisible(false)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  headerLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconWrap:     { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  headerTitle:        { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, letterSpacing: -0.3 },
  headerSub:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  signOutBtn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerLight },
  signOutText:        { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.danger },

  statsRow:           { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statPill:           { flex: 1, backgroundColor: colors.cardBg, borderRadius: 12, padding: 10, alignItems: 'center', ...shadow },
  statNum:            { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  statLabel:          { fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2, textAlign: 'center' },

  listContent:        { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 8 },
  listEmpty:          { flex: 1 },

  // Event card
  card:               { backgroundColor: colors.cardBg, borderRadius: 16, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12, ...shadow },
  cardThumb:          { width: 72, height: 72, borderRadius: 10 },
  cardThumbFallback:  { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  cardInfo:           { flex: 1 },
  cardTitle:          { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 4, lineHeight: 20 },
  cardDate:           { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 2 },
  cardLoc:            { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 6 },
  statusPill:         { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText:     { fontSize: 11, fontFamily: 'Inter_700Bold' },
  rejectedReason:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.danger, marginTop: 4, lineHeight: 16 },

  // FAB
  fab:                { position: 'absolute', right: 20, bottom: 32, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', ...shadow, shadowOpacity: 0.25, elevation: 6 },

  // Empty
  emptyWrap:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTitle:         { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginBottom: 6 },
  emptyBody:          { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  // Modal
  modalHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  formContent:        { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 60 },

  fieldLabel:         { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 16 },
  fieldLabelRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 },
  charCount:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginBottom: 6 },
  charCountWarn:      { color: colors.accent },

  input:              { backgroundColor: colors.cardBg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  inputMulti:         { height: 110, textAlignVertical: 'top' },

  dateBtn:            { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cardBg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  dateBtnText:        { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.textPrimary },
  datePlaceholder:    { color: colors.textSecondary },

  // Image strip
  imageStrip:         { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  imageThumbWrap:     { position: 'relative' },
  imageThumb:         { width: 80, height: 80, borderRadius: 10 },
  imageRemoveBtn:     { position: 'absolute', top: -6, right: -6 },
  imageAddBtn:        { width: 80, height: 80, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 2 },
  imageAddText:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary },

  // Form actions
  formActions:        { marginTop: 28, gap: 10 },
  primaryBtn:         { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  ghostBtn:           { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  ghostBtnText:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dangerBtn:          { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 12 },
  dangerBtnText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.danger },

  // Date picker
  pickerBackdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet:        { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  pickerSheetHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerSheetTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  pickerDoneText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary },
})
