import { useQuizStore } from '@/lib/quiz/store'
import LandingScreen from './LandingScreen'
import QuizScreen from './QuizScreen'
import LoadingScreen from './LoadingScreen'
import ResultsScreen from './ResultsScreen'

export default function QuizNavigator({ onClose }: { onClose?: () => void }) {
  const phase = useQuizStore(s => s.phase)
  switch (phase) {
    case 'landing':  return <LandingScreen onClose={onClose} />
    case 'quiz':     return <QuizScreen />
    case 'loading':  return <LoadingScreen />
    case 'results':  return <ResultsScreen onClose={onClose} />
  }
}
