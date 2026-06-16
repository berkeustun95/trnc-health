import { useEffect } from 'react'
import { useQuizStore } from '@/lib/quiz/store'
import { useReviewStore } from './reviewStore'
import LandingScreen from './LandingScreen'
import QuizScreen from './QuizScreen'
import LoadingScreen from './LoadingScreen'
import ResultsScreen from './ResultsScreen'
import PharmacistPickerScreen from './PharmacistPickerScreen'
import AwaitingReviewScreen from './AwaitingReviewScreen'
import type { Lang } from '@/data/quiz/translations'

const LANG_MAP: Record<string, Lang> = {
  Turkish: 'tr',
  English: 'en',
  Arabic:  'ar',
  Russian: 'ru',
  Greek:   'el',
  French:  'fr',
  Spanish: 'es',
  German:  'de',
  Persian: 'fa',
}

export default function QuizNavigator({ onClose, profileLang }: { onClose?: () => void; profileLang?: string }) {
  const quizPhase   = useQuizStore(s => s.phase)
  const setLanguage = useQuizStore(s => s.setLanguage)
  const reviewPhase = useReviewStore(s => s.phase)
  const finalResult = useReviewStore(s => s.finalResult)
  const reviewedAt  = useReviewStore(s => s.reviewedAt)

  useEffect(() => {
    setLanguage(LANG_MAP[profileLang ?? ''] ?? 'en')
  }, [profileLang])

  if (quizPhase === 'results') {
    if (!reviewPhase)               return <PharmacistPickerScreen />
    if (reviewPhase === 'awaiting') return <AwaitingReviewScreen onClose={onClose} />
    if (reviewPhase === 'complete') return <ResultsScreen result={finalResult} reviewedAt={reviewedAt} onClose={onClose} />
  }

  switch (quizPhase) {
    case 'landing': return <LandingScreen onClose={onClose} />
    case 'quiz':    return <QuizScreen />
    case 'loading': return <LoadingScreen />
    default:        return null
  }
}
