// ═══════════════════════════════════════════════════════════════
// QUIZ QUESTIONS
// Each question maps to recommendation logic in the engine.
// Question IDs are stable — don't rename them, the engine depends on them.
// ═══════════════════════════════════════════════════════════════

import { getT, type Lang } from "@/data/quiz/translations";

export type QuestionType = "single" | "multi" | "scale";

export interface QuizOption {
  id: string;
  label: string;
  emoji?: string;
  description?: string;
  group?: string;
}

export interface QuizQuestion {
  id: string;
  section: string;
  sectionEmoji: string;
  question: string;
  subtitle?: string;
  type: QuestionType;
  options: QuizOption[];
  required: boolean;
  allowCustom?: boolean;
  showIf?: (answers: Record<string, string | string[]>) => boolean;
}

export const quizQuestions: QuizQuestion[] = [
  // ── SECTION 1: BASICS ──
  {
    id: "age",
    section: "About You",
    sectionEmoji: "👤",
    question: "What is your age range?",
    type: "single",
    required: true,
    options: [
      { id: "20-30", label: "20–30", emoji: "🌱" },
      { id: "30-40", label: "30–40", emoji: "🌿" },
      { id: "40-50", label: "40–50", emoji: "🌳" },
      { id: "50-60", label: "50–60", emoji: "🏔️" },
    ],
  },
  {
    id: "sex",
    section: "About You",
    sectionEmoji: "👤",
    question: "What is your biological sex?",
    subtitle: "This affects nutrient requirements and dosing recommendations.",
    type: "single",
    required: true,
    options: [
      { id: "male", label: "Male", emoji: "♂️" },
      { id: "female", label: "Female", emoji: "♀️" },
    ],
  },
  {
    id: "menopause",
    section: "About You",
    sectionEmoji: "👤",
    question: "Are you pre- or post-menopausal?",
    type: "single",
    required: true,
    showIf: (answers) => answers.sex === "female" && answers.age !== "20-30",
    options: [
      { id: "post", label: "Yes (in menopause)", emoji: "✅" },
      { id: "pre", label: "No (not in menopause)", emoji: "❌" },
      { id: "unsure", label: "Transitioning to menopause (Peri-menopause)", emoji: "🔄" },
    ],
  },
  {
    id: "medications",
    section: "About You",
    sectionEmoji: "👤",
    question: "Are you currently taking any medications?",
    subtitle: "This is critical for checking supplement-drug interactions. Select all that apply.",
    type: "multi",
    required: true,
    options: [
      { id: "statins", label: "Statins (cholesterol)", emoji: "💊" },
      { id: "metformin", label: "Metformin (diabetes)", emoji: "💊" },
      { id: "blood-thinners", label: "Blood thinners (warfarin, etc.)", emoji: "🩸" },
      { id: "thyroid", label: "Thyroid medication", emoji: "🦋" },
      { id: "ssri", label: "Antidepressants (SSRIs)", emoji: "🧠" },
      { id: "ppi", label: "Acid reflux / PPIs", emoji: "💊" },
      { id: "bp-meds", label: "Blood pressure medication", emoji: "❤️" },
      { id: "birth-control", label: "Birth control", emoji: "💊" },
      { id: "antihistamines", label: "Antihistamines (cetirizine, loratadine)", emoji: "🤧" },
      { id: "corticosteroids", label: "Corticosteroids (prednisone)", emoji: "💊" },
      { id: "osteoporosis-meds", label: "Osteoporosis meds (bisphosphonates)", emoji: "🦴" },
      { id: "sleep-aids", label: "Sleep aids (zolpidem, benzodiazepines)", emoji: "💤" },
      { id: "antibiotics", label: "Antibiotics (current course)", emoji: "💊" },
      { id: "antifungals", label: "Antifungals", emoji: "💊" },
      { id: "immunosuppressants", label: "Immunosuppressants", emoji: "🛡️" },
      { id: "seizure-meds", label: "Seizure medications (anticonvulsants)", emoji: "⚡" },
      { id: "hrt", label: "Hormone replacement therapy (HRT)", emoji: "🔄" },
      { id: "anti-asthmatic", label: "Anti-asthmatic (inhalers, montelukast)", emoji: "🌬️" },
      { id: "anti-neoplastic", label: "Anti-neoplastic (chemotherapy)", emoji: "🏥" },
      { id: "none", label: "None", emoji: "✅" },
    ],
  },

  // ── SECTION 2: LIFESTYLE ──
  {
    id: "diet",
    section: "Your Lifestyle",
    sectionEmoji: "🥗",
    question: "How would you describe your diet?",
    type: "single",
    required: true,
    options: [
      { id: "omnivore", label: "Omnivore", emoji: "🍖", description: "Eat everything" },
      { id: "vegetarian", label: "Vegetarian", emoji: "🥚", description: "No meat, but eggs/dairy" },
      { id: "vegan", label: "Vegan", emoji: "🌱", description: "Fully plant-based" },
      { id: "keto", label: "Keto / Low-Carb", emoji: "🥑", description: "High fat, low carb" },
      { id: "mediterranean", label: "Mediterranean", emoji: "🫒", description: "Whole foods, olive oil, fish" },
      { id: "no-specific", label: "No specific diet", emoji: "🍽️", description: "I eat what I eat" },
    ],
  },
  {
    id: "exercise",
    section: "Your Lifestyle",
    sectionEmoji: "🥗",
    question: "How often do you exercise?",
    type: "single",
    required: true,
    options: [
      { id: "rarely", label: "Rarely", emoji: "🛋️", description: "Less than once a week" },
      { id: "light", label: "1–2x per week", emoji: "🚶", description: "Light activity" },
      { id: "moderate", label: "3–4x per week", emoji: "🏃", description: "Regular workouts" },
      { id: "heavy", label: "5+ days per week", emoji: "🏋️", description: "Serious training" },
    ],
  },
  {
    id: "stress",
    section: "Your Lifestyle",
    sectionEmoji: "🥗",
    question: "How would you rate your stress level?",
    type: "single",
    required: true,
    options: [
      { id: "low", label: "Low (1–3)", emoji: "😌", description: "Generally relaxed" },
      { id: "moderate", label: "Moderate (4–6)", emoji: "😐", description: "Normal life stress" },
      { id: "high", label: "High (7–10)", emoji: "😰", description: "Frequently overwhelmed" },
    ],
  },
  {
    id: "sleep",
    section: "Your Lifestyle",
    sectionEmoji: "🥗",
    question: "How is your sleep quality?",
    type: "single",
    required: true,
    options: [
      { id: "great", label: "Great", emoji: "😴", description: "Fall asleep easily, stay asleep" },
      { id: "okay", label: "Okay", emoji: "🙂", description: "Occasional issues" },
      { id: "poor", label: "Poor", emoji: "😵", description: "Regular trouble falling or staying asleep" },
    ],
  },
  {
    id: "sun",
    section: "Your Lifestyle",
    sectionEmoji: "🥗",
    question: "How much sun exposure do you get daily?",
    type: "single",
    required: true,
    options: [
      { id: "lots", label: "Lots", emoji: "☀️", description: "Outdoor job or lifestyle" },
      { id: "some", label: "Some", emoji: "🌤️", description: "30+ minutes per day" },
      { id: "minimal", label: "Minimal", emoji: "🏢", description: "Mostly indoors" },
    ],
  },

  // ── SECTION 3: GOALS ──
  {
    id: "primary-goal",
    section: "Your Goals",
    sectionEmoji: "🎯",
    question: "What is your primary health goal?",
    subtitle: "Choose the one that matters most to you right now.",
    type: "single",
    required: true,
    options: [
      { id: "energy", label: "Energy & Vitality", emoji: "⚡" },
      { id: "sleep", label: "Better Sleep", emoji: "😴" },
      { id: "immunity", label: "Immune Support", emoji: "🛡️" },
      { id: "joints", label: "Joint Health & Mobility", emoji: "🦴" },
      { id: "stress", label: "Stress & Anxiety", emoji: "🧘" },
      { id: "cognitive", label: "Brain & Focus", emoji: "🧠" },
      { id: "athletic", label: "Athletic Performance", emoji: "🏆" },
      { id: "gut", label: "Gut Health & Digestion", emoji: "🦠" },
      { id: "heart", label: "Heart Health", emoji: "❤️" },
      { id: "skin", label: "Skin, Hair & Nails", emoji: "✨" },
      { id: "weight", label: "Weight Management", emoji: "⚖️" },
      { id: "longevity", label: "Longevity & Anti-Aging", emoji: "🧬" },
    ],
  },
  {
    id: "secondary-goal",
    section: "Your Goals",
    sectionEmoji: "🎯",
    question: "Do you have a secondary health goal?",
    type: "single",
    required: false,
    options: [
      { id: "energy", label: "Energy & Vitality", emoji: "⚡" },
      { id: "sleep", label: "Better Sleep", emoji: "😴" },
      { id: "immunity", label: "Immune Support", emoji: "🛡️" },
      { id: "joints", label: "Joint Health", emoji: "🦴" },
      { id: "stress", label: "Stress & Anxiety", emoji: "🧘" },
      { id: "cognitive", label: "Brain & Focus", emoji: "🧠" },
      { id: "athletic", label: "Athletic Performance", emoji: "🏆" },
      { id: "gut", label: "Gut Health", emoji: "🦠" },
      { id: "heart", label: "Heart Health", emoji: "❤️" },
      { id: "skin", label: "Skin, Hair & Nails", emoji: "✨" },
      { id: "weight", label: "Weight Management", emoji: "⚖️" },
      { id: "longevity", label: "Longevity", emoji: "🧬" },
      { id: "none", label: "No secondary goal", emoji: "➡️" },
    ],
  },

  // ── SECTION 3.5: COMPLAINTS ──
  {
    id: "complaints",
    section: "Your Complaints",
    sectionEmoji: "🩺",
    question: "What are your current complaints or concerns?",
    subtitle: "Select all that apply — this helps tailor your stack to your actual symptoms.",
    type: "multi",
    required: false,
    options: [
      // Energy & Fatigue
      { id: "chronic-fatigue", label: "Chronic fatigue / always tired", emoji: "😴", group: "Energy & Fatigue" },
      { id: "afternoon-crash", label: "Afternoon energy crashes", emoji: "⬇️", group: "Energy & Fatigue" },
      { id: "unrefreshed-sleep", label: "Waking unrefreshed / not rested", emoji: "🛌", group: "Energy & Fatigue" },
      { id: "brain-fog", label: "Brain fog, poor concentration, forgetfulness", emoji: "🌫️", group: "Energy & Fatigue" },
      // Mood, Stress & Sleep
      { id: "anxiety", label: "Anxiety or worry", emoji: "😰", group: "Mood, Stress & Sleep" },
      { id: "low-mood", label: "Low mood / sadness", emoji: "😔", group: "Mood, Stress & Sleep" },
      { id: "irritability", label: "Irritability / mood swings", emoji: "😤", group: "Mood, Stress & Sleep" },
      { id: "stress-overwhelm", label: "Difficulty coping with stress", emoji: "🌀", group: "Mood, Stress & Sleep" },
      { id: "trouble-falling-asleep", label: "Trouble falling asleep", emoji: "🌙", group: "Mood, Stress & Sleep" },
      { id: "waking-at-night", label: "Waking at night / restless sleep", emoji: "💤", group: "Mood, Stress & Sleep" },
      // Hair, Skin & Nails
      { id: "brittle-nails", label: "Brittle or weak nails", emoji: "💅", group: "Hair, Skin & Nails" },
      { id: "hair-loss", label: "Hair thinning or shedding", emoji: "💇", group: "Hair, Skin & Nails" },
      { id: "dry-skin", label: "Dry or flaky skin", emoji: "🧴", group: "Hair, Skin & Nails" },
      { id: "slow-healing", label: "Slow wound healing", emoji: "🩹", group: "Hair, Skin & Nails" },
      { id: "premature-graying", label: "Premature graying", emoji: "🩶", group: "Hair, Skin & Nails" },
      // Muscle, Joint & Recovery
      { id: "muscle-cramps", label: "Muscle cramps or twitching", emoji: "⚡", group: "Muscle, Joint & Recovery" },
      { id: "joint-stiffness", label: "Joint stiffness or aches", emoji: "🦴", group: "Muscle, Joint & Recovery" },
      { id: "general-weakness", label: "General muscle weakness", emoji: "😩", group: "Muscle, Joint & Recovery" },
      { id: "slow-recovery", label: "Slow recovery after exercise", emoji: "🔄", group: "Muscle, Joint & Recovery" },
      // Immunity
      { id: "frequent-illness", label: "Frequent colds, infections, or slow healing", emoji: "🤒", group: "Immunity" },
      { id: "seasonal-allergies", label: "Worsening seasonal allergies", emoji: "🤧", group: "Immunity" },
      // Digestion & Gut
      { id: "bloating-gas", label: "Bloating or gas", emoji: "🎈", group: "Digestion & Gut" },
      { id: "indigestion", label: "Indigestion / heartburn", emoji: "🔥", group: "Digestion & Gut" },
      { id: "constipation", label: "Constipation", emoji: "🌿", group: "Digestion & Gut" },
      { id: "food-sensitivities", label: "Food sensitivities or discomfort after eating", emoji: "⚠️", group: "Digestion & Gut" },
      // Bone Health & Aging
      { id: "bone-density-concern", label: "Bone density or osteoporosis concern", emoji: "🦷", group: "Bone Health & Aging" },
      { id: "age-related-decline", label: "Age-related memory, energy, or vision decline", emoji: "🧓", group: "Bone Health & Aging" },
      // Dietary Gaps & Life Stages
      { id: "restrictive-diet", label: "Vegan or very restrictive diet", emoji: "🌱", group: "Dietary Gaps & Life Stages" },
      { id: "pregnancy-planning", label: "Pregnant or trying to conceive", emoji: "🤰", group: "Dietary Gaps & Life Stages" },
      { id: "post-surgery", label: "Post-surgery or injury recovery", emoji: "🏥", group: "Dietary Gaps & Life Stages" },
      { id: "poor-nutrition", label: "Not eating enough variety or skipping meals", emoji: "🥗", group: "Dietary Gaps & Life Stages" },
      // Fitness & Body Goals
      { id: "muscle-building", label: "Building muscle mass", emoji: "💪", group: "Fitness & Body Goals" },
      { id: "weight-management-goal", label: "Weight management or fat loss", emoji: "⚖️", group: "Fitness & Body Goals" },
      { id: "gym-performance", label: "Gym performance or endurance", emoji: "🏋️", group: "Fitness & Body Goals" },
      // Attention & Focus
      { id: "attention-focus", label: "Difficulty focusing, easily distracted, trouble completing tasks", emoji: "🎯", group: "Attention & Focus" },
      // Appetite
      { id: "poor-appetite", label: "Poor appetite or eating too little", emoji: "🍽️", group: "Appetite" },
      { id: "sugar-cravings", label: "Sugar cravings or overeating", emoji: "🍬", group: "Appetite" },
      { id: "poor-satiety", label: "Low sense of fullness after meals", emoji: "😋", group: "Appetite" },
      // No complaints
      { id: "none", label: "No complaints", emoji: "✅" },
    ],
  },

  // ── SECTION 4: PREFERENCES ──
  {
    id: "allergies",
    section: "Preferences",
    sectionEmoji: "⚙️",
    question: "Do you have any allergies or sensitivities?",
    subtitle: "Select all that apply. This filters out unsafe product recommendations.",
    type: "multi",
    required: true,
    allowCustom: true,
    options: [
      { id: "shellfish", label: "Shellfish", emoji: "🦐" },
      { id: "soy", label: "Soy", emoji: "🫘" },
      { id: "gluten", label: "Gluten", emoji: "🌾" },
      { id: "fish", label: "Fish", emoji: "🐟" },
      { id: "dairy", label: "Dairy", emoji: "🥛" },
      { id: "none", label: "None", emoji: "✅" },
    ],
  },
  {
    id: "form",
    section: "Preferences",
    sectionEmoji: "⚙️",
    question: "What form of supplements do you prefer?",
    type: "single",
    required: false,
    options: [
      { id: "capsules", label: "Capsules / Tablets", emoji: "💊" },
      { id: "gummies", label: "Gummies", emoji: "🍬" },
      { id: "powder", label: "Powder", emoji: "🥄" },
      { id: "liquid", label: "Liquid", emoji: "💧" },
      { id: "no-preference", label: "No preference", emoji: "👌" },
    ],
  },
  {
    id: "currency",
    section: "Preferences",
    sectionEmoji: "⚙️",
    question: "What currency do you prefer?",
    type: "single",
    required: true,
    options: [
      { id: "usd", label: "USD ($)", emoji: "🇺🇸" },
      { id: "eur", label: "EUR (€)", emoji: "🇪🇺" },
      { id: "gbp", label: "GBP (£)", emoji: "🇬🇧" },
      { id: "try", label: "TRY (₺)", emoji: "🇹🇷" },
    ],
  },
  {
    id: "budget",
    section: "Preferences",
    sectionEmoji: "⚙️",
    question: "What's your monthly supplement budget?",
    type: "single",
    required: true,
    options: [
      { id: "starter", label: "Starter", emoji: "🌱", description: "$15–25 / €14–23 / £12–20 / ₺510–850" },
      { id: "budget", label: "Budget", emoji: "💚", description: "$25–50 / €23–46 / £20–40 / ₺850–1,700" },
      { id: "mid", label: "Mid-Range", emoji: "💎", description: "$50–100 / €46–92 / £40–80 / ₺1,700–3,400" },
      { id: "premium", label: "Premium", emoji: "👑", description: "$100–150 / €92–138 / £80–120 / ₺3,400–5,100" },
      { id: "ultra", label: "Ultra", emoji: "🏆", description: "$150+ / €138+ / £120+ / ₺5,100+" },
    ],
  },

  // ── EMAIL CAPTURE ──
  {
    id: "newsletter",
    section: "Stay Updated",
    sectionEmoji: "📬",
    question: "Want monthly pharmacist-vetted supplement insights?",
    subtitle: "Join our free newsletter — new research, myth-busting, and product alerts.",
    type: "single",
    required: false,
    options: [
      { id: "yes", label: "Yes, sign me up!", emoji: "📧" },
      { id: "no", label: "No thanks, just show my results", emoji: "➡️" },
    ],
  },
];

// Returns questions with localized text, preserving showIf logic from the base
export function getVisibleQuestions(
  answers: Record<string, string | string[]>,
  lang: Lang = "tr"
): QuizQuestion[] {
  const t = getT(lang).questions;
  return quizQuestions
    .filter((q) => !q.showIf || q.showIf(answers))
    .map((q) => {
      const tr = t[q.id];
      if (!tr) return q;
      return {
        ...q,
        section: tr.section,
        question: tr.question,
        subtitle: tr.subtitle ?? q.subtitle,
        options: q.options.map((opt) => {
          const optTr = tr.options[opt.id];
          if (!optTr) return opt;
          return { ...opt, label: optTr.label, description: optTr.description ?? opt.description, group: optTr.group ?? opt.group };
        }),
      };
    });
}

// Get sections for progress tracking
export function getSections(
  answers: Record<string, string | string[]>,
  lang: Lang = "tr"
): { name: string; emoji: string; questionCount: number }[] {
  const visible = getVisibleQuestions(answers, lang);
  const sections: { name: string; emoji: string; questionCount: number }[] = [];

  visible.forEach((q) => {
    const existing = sections.find((s) => s.name === q.section);
    if (existing) {
      existing.questionCount++;
    } else {
      sections.push({
        name: q.section,
        emoji: q.sectionEmoji,
        questionCount: 1,
      });
    }
  });

  return sections;
}
