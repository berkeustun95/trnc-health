import { useState, useEffect, useCallback } from 'react'
import { View, FlatList, StyleSheet, useWindowDimensions } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenHeader, PageCanvas, CardSkeleton, EmptyState, ErrorState } from '../components/ui'
import DovecProjectCard from '../components/dovec/DovecProjectCard'
import DovecEnquiryForm from '../components/dovec/DovecEnquiryForm'
import DovecThankYou from '../components/dovec/DovecThankYou'
import DovecProjectScreen from './DovecProjectScreen'
import { t } from '../constants/i18n'
import { listBottomPad } from '../constants/theme'
import { loadDovec } from '../utils/loadDovec'

// Döveç projects opened from Emlak: list -> project -> enquiry form -> thank-you, one screen with its own layer.
// Android back / iOS edge swipe: App.js chain asks backRef first (a layer closes), and closes the overlay when it says no.
// A guest is stopped by onRequireAccount (App's sign-up sheet) before the form.
const TITLE_KEY = 'dovecTitle'

export default function DovecProjectsScreen({ lang, onClose, onRequireAccount, backRef }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [data, setData] = useState(null)       // { settings, projects }
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [layer, setLayer] = useState({ name: 'list' })   // list | detail | form | thanks

  const load = useCallback(() => {
    setLoading(true); setLoadError(false)
    loadDovec().then(setData, () => setLoadError(true)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!backRef) return undefined
    backRef.current = () => {
      if (layer.name === 'form' || layer.name === 'thanks') { setLayer({ name: 'detail', project: layer.project }); return true }
      if (layer.name === 'detail') { setLayer({ name: 'list' }); return true }
      return false
    }
    return () => { backRef.current = null }
  }, [backRef, layer])

  const back = () => { if (!backRef?.current?.()) onClose() }
  const project = layer.project
  const title = layer.name === 'list' ? t(TITLE_KEY, lang) : (project?.name ?? t(TITLE_KEY, lang))
  const enquire = () => {
    if (onRequireAccount?.('dovecGateAccount')) return
    setLayer({ name: 'form', project })
  }

  let content
  if (layer.name === 'detail') {
    content = <DovecProjectScreen project={project} lang={lang} onEnquire={enquire} />
  } else if (layer.name === 'form') {
    content = <DovecEnquiryForm project={project} lang={lang} onSent={ref => setLayer({ name: 'thanks', project, reference: ref })} />
  } else if (layer.name === 'thanks') {
    content = (
      <DovecThankYou project={project} reference={layer.reference} whatsapp={data?.settings?.whatsapp_e164 ?? null} lang={lang}
        onBack={() => setLayer({ name: 'detail', project })} />
    )
  } else if (loading) {
    content = <View style={s.list}>{[0, 1, 2].map(i => <CardSkeleton key={i} height={260} style={{ marginBottom: 12 }} />)}</View>
  } else if (loadError) {
    content = <ErrorState lang={lang} message={t('dovecLoadError', lang)} onRetry={load} style={{ marginTop: 40 }} />
  } else if (!data?.projects?.length) {
    content = <EmptyState icon="business-outline" category="homeLife" title={t('dovecEmpty', lang)} style={{ marginTop: 28 }} />
  } else {
    content = (
      <FlatList
        data={data.projects}
        keyExtractor={p => p.id}
        contentContainerStyle={[s.list, { paddingBottom: listBottomPad(insets) }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={Gap}
        renderItem={({ item }) => (
          <DovecProjectCard project={item} lang={lang} width={width - 32} onPress={() => setLayer({ name: 'detail', project: item })} />
        )}
      />
    )
  }

  return (
    <PageCanvas flat>
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader title={title} onBack={back} lang={lang} />
        <View style={s.safe}>{content}</View>
      </SafeAreaView>
    </PageCanvas>
  )
}

const Gap = () => <View style={{ height: 12 }} />

const s = StyleSheet.create({
  safe: { flex: 1 },
  list: { padding: 16 },
})
