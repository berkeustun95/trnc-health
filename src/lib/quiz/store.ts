import { create } from "zustand";
import { getVisibleQuestions } from "@/data/quiz/questions";
import { generateRecommendations, type QuizResult } from "@/lib/quiz/engine";
import type { CurrencyCode } from "@/lib/quiz/currency";
import type { Lang } from "@/data/quiz/translations";

interface QuizState {
  currentStep: number;
  phase: "landing" | "quiz" | "loading" | "results";
  answers: Record<string, string | string[]>;
  result: QuizResult | null;
  email: string;
  currency: CurrencyCode;
  language: Lang;

  setAnswer: (questionId: string, answer: string | string[]) => void;
  toggleMultiAnswer: (questionId: string, optionId: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  startQuiz: () => void;
  calculateResults: () => void;
  setEmail: (email: string) => void;
  setCurrency: (currency: CurrencyCode) => void;
  setLanguage: (lang: Lang) => void;
  resetQuiz: () => void;

  getProgress: () => number;
  getTotalQuestions: () => number;
  getCurrentQuestion: () => ReturnType<typeof getVisibleQuestions>[number] | null;
  canProceed: () => boolean;
}

export const useQuizStore = create<QuizState>((set, get) => ({
  currentStep: 0,
  phase: "landing",
  answers: {},
  result: null,
  email: "",
  currency: "usd",
  language: "tr",

  setAnswer: (questionId, answer) => {
    set((state) => {
      const newAnswers = { ...state.answers, [questionId]: answer };
      if (questionId === "currency") {
        return { answers: newAnswers, currency: answer as CurrencyCode };
      }
      return { answers: newAnswers };
    });
  },

  toggleMultiAnswer: (questionId, optionId) => {
    set((state) => {
      const current = (state.answers[questionId] as string[]) || [];
      if (optionId === "none") {
        return { answers: { ...state.answers, [questionId]: ["none"] } };
      }
      let updated: string[];
      if (current.includes(optionId)) {
        updated = current.filter((id) => id !== optionId);
      } else {
        updated = [...current.filter((id) => id !== "none"), optionId];
      }
      return { answers: { ...state.answers, [questionId]: updated } };
    });
  },

  nextStep: () => {
    const { currentStep, answers, language } = get();
    const questions = getVisibleQuestions(answers, language);
    if (currentStep < questions.length - 1) {
      set({ currentStep: currentStep + 1 });
    } else {
      get().calculateResults();
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    if (currentStep > 0) set({ currentStep: currentStep - 1 });
  },

  goToStep: (step) => set({ currentStep: step }),

  startQuiz: () => set({ phase: "quiz", currentStep: 0 }),

  calculateResults: () => {
    set({ phase: "loading" });
    setTimeout(() => {
      const { answers, language, email } = get();
      const result = generateRecommendations(answers, language);
      set({ result, phase: "results" });
    }, 2500);
  },

  setEmail: (email) => set({ email }),
  setCurrency: (currency) => set({ currency }),
  setLanguage: (lang) => {
    set({ language: lang });
    const { phase, answers } = get();
    if (phase === "results") {
      const result = generateRecommendations(answers, lang);
      set({ result });
    }
  },

  resetQuiz: () => set({ currentStep: 0, phase: "landing", answers: {}, result: null, email: "" }),

  getProgress: () => {
    const { currentStep, answers, language } = get();
    const questions = getVisibleQuestions(answers, language);
    return questions.length > 0 ? ((currentStep + 1) / questions.length) * 100 : 0;
  },

  getTotalQuestions: () => {
    const { answers, language } = get();
    return getVisibleQuestions(answers, language).length;
  },

  getCurrentQuestion: () => {
    const { currentStep, answers, language } = get();
    const questions = getVisibleQuestions(answers, language);
    return questions[currentStep] || null;
  },

  canProceed: () => {
    const question = get().getCurrentQuestion();
    if (!question) return false;
    if (!question.required) return true;
    const answer = get().answers[question.id];
    if (!answer) return false;
    if (Array.isArray(answer)) return answer.length > 0;
    return answer !== "";
  },
}));
