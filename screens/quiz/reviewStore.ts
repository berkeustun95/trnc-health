import { create } from 'zustand'
import { supabase } from '../../lib/supabase'
import { calculateTimeoutAt } from '../../constants/quizTimeout'

export interface ReviewFacility {
  id: string
  name: string
  total_points: number
  avg_response_mins: number
  total_reviews: number
}

interface ReviewState {
  phase: 'picker' | 'awaiting' | 'complete' | null
  selectedFacility: ReviewFacility | null
  submissionId: string | null
  timeoutAt: Date | null
  finalResult: any | null
}

interface ReviewStore extends ReviewState {
  submitForReview: (answers: Record<string, any>, generatedResult: any, facility: ReviewFacility) => Promise<void>
  onApproved: (finalResult: any) => void
  handleTimeout: () => Promise<void>
  reset: () => void
}

const initial: ReviewState = {
  phase: null,
  selectedFacility: null,
  submissionId: null,
  timeoutAt: null,
  finalResult: null,
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  ...initial,

  submitForReview: async (answers, generatedResult, facility) => {
    const timeoutAt = calculateTimeoutAt()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) return

    const { data, error } = await supabase
      .from('quiz_submissions')
      .insert({
        customer_id: authData.user.id,
        answers,
        generated_result: generatedResult,
        assigned_facility_id: facility.id,
        timeout_at: timeoutAt.toISOString(),
      })
      .select('id')
      .single()

    if (error || !data) return

    set({ phase: 'awaiting', selectedFacility: facility, submissionId: data.id, timeoutAt })
  },

  onApproved: (finalResult) => {
    set({ phase: 'complete', finalResult })
  },

  handleTimeout: async () => {
    const { submissionId } = get()
    if (submissionId) {
      await supabase
        .from('quiz_submissions')
        .update({ status: 'timed_out' })
        .eq('id', submissionId)
        .eq('status', 'pending')
    }
    set({ phase: 'picker', selectedFacility: null, submissionId: null, timeoutAt: null })
  },

  reset: () => set(initial),
}))
