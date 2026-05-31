import { supplements, type Supplement } from "@/data/quiz/supplements";
import {
  checkDrugInteractions,
  checkStackInteractions,
  type Interaction,
} from "@/data/quiz/interactions";
import { getT, type Lang } from "@/data/quiz/translations";

export interface RecommendedSupplement {
  supplement: Supplement;
  reason: string;
  priority: "essential" | "recommended" | "optional";
  doseAdjustment?: string;
  warnings: Interaction[];
}

export interface QuizResult {
  stack: RecommendedSupplement[];
  interactions: Interaction[];
  timingSchedule: TimingSlot[];
  summary: string;
  disclaimers: string[];
}

export interface TimingSlot {
  time: string;
  emoji: string;
  supplements: { name: string; dose: string; note?: string }[];
}

type Answers = Record<string, string | string[]>;

const goalSupplements: Record<
  string,
  { essential: string[]; recommended: string[]; optional: string[] }
> = {
  energy: {
    essential: ["vitamin-b12", "coq10"],
    recommended: ["vitamin-d3", "creatine", "iron"],
    optional: ["electrolytes", "ashwagandha"],
  },
  sleep: {
    essential: ["magnesium", "l-theanine"],
    recommended: ["ashwagandha"],
    optional: ["melatonin"],
  },
  immunity: {
    essential: ["vitamin-d3", "zinc", "vitamin-c"],
    recommended: ["probiotics", "nac"],
    optional: ["omega-3"],
  },
  joints: {
    essential: ["omega-3", "curcumin"],
    recommended: ["collagen", "vitamin-d3"],
    optional: [],
  },
  stress: {
    essential: ["ashwagandha", "magnesium"],
    recommended: ["l-theanine", "omega-3"],
    optional: ["vitamin-b12"],
  },
  cognitive: {
    essential: ["omega-3", "creatine"],
    recommended: ["l-theanine", "magnesium"],
    optional: ["vitamin-b12", "coq10"],
  },
  athletic: {
    essential: ["creatine", "electrolytes"],
    recommended: ["omega-3", "vitamin-d3", "magnesium"],
    optional: ["collagen", "ashwagandha"],
  },
  gut: {
    essential: ["probiotics", "fiber-psyllium"],
    recommended: ["zinc", "nac"],
    optional: ["collagen"],
  },
  heart: {
    essential: ["omega-3", "coq10"],
    recommended: ["magnesium", "vitamin-k2", "fiber-psyllium"],
    optional: ["berberine"],
  },
  skin: {
    essential: ["collagen", "vitamin-c"],
    recommended: ["zinc", "omega-3"],
    optional: [],
  },
  weight: {
    essential: ["fiber-psyllium", "berberine"],
    recommended: ["probiotics", "omega-3"],
    optional: ["l-theanine"],
  },
  longevity: {
    essential: ["omega-3", "vitamin-d3", "coq10"],
    recommended: ["nac", "creatine", "magnesium"],
    optional: ["curcumin", "collagen"],
  },
};

const budgetLimits: Record<string, number> = {
  starter: 2,
  budget: 3,
  mid: 5,
  premium: 7,
  ultra: 10,
};

export function generateRecommendations(answers: Answers, lang: Lang = "tr"): QuizResult {
  const t = getT(lang).engine;
  const fmtGoal = (id: string) => t.goalLabels[id] || id;

  const primaryGoal = answers["primary-goal"] as string;
  const secondaryGoal = answers["secondary-goal"] as string;
  const medications = (answers.medications as string[]) || [];
  const budget = (answers.budget as string) || "mid";
  const age = answers.age as string;
  const sex = answers.sex as string;
  const menopause = answers.menopause as string;
  const diet = answers.diet as string;
  const exercise = answers.exercise as string;
  const stress = answers.stress as string;
  const sleep = answers.sleep as string;
  const sun = answers.sun as string;
  const allergies = (answers.allergies as string[]) || [];
  const complaints = (answers.complaints as string[]) || [];

  const hasMedication = (id: string) =>
    !medications.includes("none") && medications.includes(id);
  const hasComplaint = (id: string) => complaints.length > 0 && !complaints.includes("none") && complaints.includes(id);
  const maxSupplements = budgetLimits[budget] || 5;

  const candidates = new Map<
    string,
    { priority: "essential" | "recommended" | "optional"; reason: string }
  >();

  const addIfAbsent = (id: string, priority: "essential" | "recommended" | "optional", reason: string) => {
    if (!candidates.has(id)) candidates.set(id, { priority, reason });
  };
  const bumpPriority = (id: string, priority: "essential" | "recommended" | "optional", reason: string) => {
    const order = { essential: 0, recommended: 1, optional: 2 };
    const existing = candidates.get(id);
    if (!existing) {
      candidates.set(id, { priority, reason });
    } else if (order[priority] < order[existing.priority]) {
      candidates.set(id, { ...existing, priority });
    }
  };

  const goalMap = goalSupplements[primaryGoal];
  if (goalMap) {
    goalMap.essential.forEach((id) =>
      candidates.set(id, { priority: "essential", reason: t.coreReason(fmtGoal(primaryGoal)) })
    );
    goalMap.recommended.forEach((id) => {
      if (!candidates.has(id))
        candidates.set(id, { priority: "recommended", reason: t.supportsReason(fmtGoal(primaryGoal)) });
    });
    goalMap.optional.forEach((id) => {
      if (!candidates.has(id))
        candidates.set(id, { priority: "optional", reason: t.additionalReason(fmtGoal(primaryGoal)) });
    });
  }

  if (secondaryGoal && secondaryGoal !== "none") {
    const secondaryMap = goalSupplements[secondaryGoal];
    if (secondaryMap) {
      secondaryMap.essential.forEach((id) => {
        if (!candidates.has(id))
          candidates.set(id, { priority: "recommended", reason: t.secondaryKeyReason(fmtGoal(secondaryGoal)) });
      });
      secondaryMap.recommended.forEach((id) => {
        if (!candidates.has(id))
          candidates.set(id, { priority: "optional", reason: t.secondarySupportsReason(fmtGoal(secondaryGoal)) });
      });
    }
  }

  if (diet === "vegan") {
    candidates.set("vitamin-b12", { priority: "essential", reason: t.reasons.veganB12 });
    if (!candidates.has("iron"))
      candidates.set("iron", { priority: "recommended", reason: t.reasons.veganIron });
    if (!candidates.has("omega-3"))
      candidates.set("omega-3", { priority: "recommended", reason: t.reasons.veganOmega3 });
  }

  if (diet === "vegetarian" && !candidates.has("vitamin-b12")) {
    candidates.set("vitamin-b12", { priority: "recommended", reason: t.reasons.vegetarianB12 });
  }

  if (diet === "keto") {
    candidates.set("electrolytes", { priority: "essential", reason: t.reasons.ketoElectrolytes });
    if (!candidates.has("magnesium"))
      candidates.set("magnesium", { priority: "recommended", reason: t.reasons.ketoMagnesium });
  }

  if (sun === "minimal") {
    candidates.set("vitamin-d3", { priority: "essential", reason: t.reasons.minimalSunD3 });
  }

  if (stress === "high") {
    if (!candidates.has("ashwagandha"))
      candidates.set("ashwagandha", { priority: "recommended", reason: t.reasons.highStressAshwagandha });
    if (!candidates.has("magnesium"))
      candidates.set("magnesium", { priority: "recommended", reason: t.reasons.highStressMagnesium });
  }

  if (sleep === "poor") {
    if (!candidates.has("magnesium"))
      candidates.set("magnesium", { priority: "essential", reason: t.reasons.poorSleepMagnesium });
    if (!candidates.has("l-theanine"))
      candidates.set("l-theanine", { priority: "recommended", reason: t.reasons.poorSleepTheanine });
  }

  if (exercise === "heavy") {
    if (!candidates.has("creatine"))
      candidates.set("creatine", { priority: "recommended", reason: t.reasons.heavyCreatine });
    if (!candidates.has("electrolytes"))
      candidates.set("electrolytes", { priority: "recommended", reason: t.reasons.heavyElectrolytes });
  }

  if (sex === "female" && menopause === "pre") {
    if (!candidates.has("iron"))
      candidates.set("iron", { priority: "recommended", reason: t.reasons.femalePre });
  }

  if (sex === "female" && menopause === "post") {
    if (!candidates.has("vitamin-d3"))
      candidates.set("vitamin-d3", { priority: "essential", reason: t.reasons.femalePostD3 });
    if (!candidates.has("vitamin-k2"))
      candidates.set("vitamin-k2", { priority: "recommended", reason: t.reasons.femalePostK2 });
  }

  if (hasMedication("statins")) {
    candidates.set("coq10", { priority: "essential", reason: t.reasons.statinsCoq10 });
  }

  if (hasMedication("metformin")) {
    candidates.set("vitamin-b12", { priority: "essential", reason: t.reasons.metforminB12 });
  }

  const sym = t.reasons.sym;

  // Energy & Fatigue
  if (hasComplaint("chronic-fatigue")) {
    bumpPriority("vitamin-b12", "essential", sym.fatigue);
    addIfAbsent("coq10", "recommended", sym.fatigue);
    if (sex === "female") addIfAbsent("iron", "recommended", sym.fatigue);
  }
  if (hasComplaint("afternoon-crash")) {
    bumpPriority("vitamin-b12", "recommended", sym.afternoonCrash);
    addIfAbsent("coq10", "recommended", sym.afternoonCrash);
    addIfAbsent("magnesium", "optional", sym.afternoonCrash);
  }
  if (hasComplaint("unrefreshed-sleep")) {
    bumpPriority("magnesium", "recommended", sym.unrefreshedSleep);
    addIfAbsent("ashwagandha", "optional", sym.unrefreshedSleep);
  }
  if (hasComplaint("brain-fog")) {
    bumpPriority("omega-3", "recommended", sym.brainFog);
    bumpPriority("vitamin-b12", "recommended", sym.brainFog);
    addIfAbsent("coq10", "optional", sym.brainFog);
  }

  // Mood, Stress & Sleep
  if (hasComplaint("anxiety")) {
    bumpPriority("ashwagandha", "recommended", sym.anxiety);
    addIfAbsent("l-theanine", "recommended", sym.anxiety);
    addIfAbsent("magnesium", "recommended", sym.anxiety);
  }
  if (hasComplaint("low-mood")) {
    bumpPriority("omega-3", "recommended", sym.lowMood);
    bumpPriority("vitamin-b12", "recommended", sym.lowMood);
    addIfAbsent("ashwagandha", "optional", sym.lowMood);
  }
  if (hasComplaint("irritability")) {
    bumpPriority("magnesium", "recommended", sym.irritability);
    addIfAbsent("vitamin-b12", "optional", sym.irritability);
  }
  if (hasComplaint("stress-overwhelm")) {
    bumpPriority("ashwagandha", "recommended", sym.stressOverwhelm);
    bumpPriority("magnesium", "recommended", sym.stressOverwhelm);
  }
  if (hasComplaint("trouble-falling-asleep")) {
    bumpPriority("magnesium", "essential", sym.sleepOnset);
    addIfAbsent("l-theanine", "recommended", sym.sleepOnset);
    addIfAbsent("melatonin", "optional", sym.sleepOnset);
  }
  if (hasComplaint("waking-at-night")) {
    bumpPriority("magnesium", "recommended", sym.sleepQuality);
    addIfAbsent("ashwagandha", "optional", sym.sleepQuality);
  }

  // Hair, Skin & Nails
  if (hasComplaint("brittle-nails")) {
    bumpPriority("zinc", "recommended", sym.brittleNails);
    addIfAbsent("collagen", "recommended", sym.brittleNails);
    addIfAbsent("vitamin-c", "optional", sym.brittleNails);
  }
  if (hasComplaint("hair-loss")) {
    bumpPriority("zinc", "recommended", sym.hairLoss);
    if (sex === "female") addIfAbsent("iron", "recommended", sym.hairLoss);
    addIfAbsent("collagen", "optional", sym.hairLoss);
  }
  if (hasComplaint("dry-skin")) {
    bumpPriority("omega-3", "recommended", sym.drySkin);
    addIfAbsent("collagen", "recommended", sym.drySkin);
  }
  if (hasComplaint("slow-healing")) {
    bumpPriority("vitamin-c", "recommended", sym.slowHealing);
    bumpPriority("zinc", "recommended", sym.slowHealing);
  }
  if (hasComplaint("premature-graying")) {
    bumpPriority("vitamin-b12", "recommended", sym.graying);
  }

  // Muscle, Joint & Recovery
  if (hasComplaint("muscle-cramps")) {
    bumpPriority("magnesium", "essential", sym.cramps);
    addIfAbsent("electrolytes", "recommended", sym.cramps);
  }
  if (hasComplaint("joint-stiffness")) {
    bumpPriority("omega-3", "essential", sym.jointPain);
    addIfAbsent("curcumin", "recommended", sym.jointPain);
  }
  if (hasComplaint("general-weakness")) {
    bumpPriority("vitamin-b12", "recommended", sym.weakness);
    if (sex === "female") addIfAbsent("iron", "recommended", sym.weakness);
    addIfAbsent("creatine", "optional", sym.weakness);
  }
  if (hasComplaint("slow-recovery")) {
    bumpPriority("omega-3", "recommended", sym.slowRecovery);
    addIfAbsent("creatine", "recommended", sym.slowRecovery);
    addIfAbsent("magnesium", "optional", sym.slowRecovery);
  }

  // Immunity
  if (hasComplaint("frequent-illness")) {
    bumpPriority("vitamin-d3", "recommended", sym.frequentIllness);
    bumpPriority("zinc", "recommended", sym.frequentIllness);
    addIfAbsent("vitamin-c", "recommended", sym.frequentIllness);
  }
  if (hasComplaint("seasonal-allergies")) {
    bumpPriority("vitamin-d3", "recommended", sym.allergies);
    addIfAbsent("probiotics", "recommended", sym.allergies);
    addIfAbsent("nac", "optional", sym.allergies);
  }

  // Digestion & Gut
  if (hasComplaint("bloating-gas")) {
    bumpPriority("probiotics", "recommended", sym.bloating);
    addIfAbsent("fiber-psyllium", "recommended", sym.bloating);
  }
  if (hasComplaint("indigestion")) {
    bumpPriority("probiotics", "recommended", sym.indigestion);
    addIfAbsent("fiber-psyllium", "optional", sym.indigestion);
  }
  if (hasComplaint("constipation")) {
    bumpPriority("fiber-psyllium", "essential", sym.constipation);
    addIfAbsent("magnesium", "recommended", sym.constipation);
  }
  if (hasComplaint("food-sensitivities")) {
    bumpPriority("probiotics", "recommended", sym.foodSens);
    addIfAbsent("zinc", "optional", sym.foodSens);
    addIfAbsent("nac", "optional", sym.foodSens);
  }

  // Bone Health & Aging
  if (hasComplaint("bone-density-concern")) {
    bumpPriority("vitamin-d3", "essential", sym.boneDensity);
    addIfAbsent("vitamin-k2", "recommended", sym.boneDensity);
    addIfAbsent("magnesium", "recommended", sym.boneDensity);
  }
  if (hasComplaint("age-related-decline")) {
    bumpPriority("omega-3", "recommended", sym.agingDecline);
    bumpPriority("coq10", "recommended", sym.agingDecline);
    addIfAbsent("vitamin-b12", "optional", sym.agingDecline);
  }

  // Dietary Gaps & Life Stages
  if (hasComplaint("restrictive-diet")) {
    bumpPriority("vitamin-b12", "essential", sym.restrictiveDiet);
    addIfAbsent("vitamin-d3", "recommended", sym.restrictiveDiet);
    addIfAbsent("omega-3", "optional", sym.restrictiveDiet);
  }
  if (hasComplaint("pregnancy-planning")) {
    bumpPriority("iron", "essential", sym.pregnancy);
    addIfAbsent("omega-3", "recommended", sym.pregnancy);
    addIfAbsent("vitamin-d3", "recommended", sym.pregnancy);
  }
  if (hasComplaint("post-surgery")) {
    bumpPriority("vitamin-c", "recommended", sym.postSurgery);
    addIfAbsent("collagen", "recommended", sym.postSurgery);
    bumpPriority("zinc", "recommended", sym.postSurgery);
  }
  if (hasComplaint("poor-nutrition")) {
    bumpPriority("vitamin-d3", "recommended", sym.poorNutrition);
    addIfAbsent("vitamin-b12", "optional", sym.poorNutrition);
    addIfAbsent("omega-3", "optional", sym.poorNutrition);
  }

  // Fitness & Body Goals
  if (hasComplaint("muscle-building")) {
    bumpPriority("creatine", "recommended", sym.muscleBuilding);
    addIfAbsent("electrolytes", "optional", sym.muscleBuilding);
    addIfAbsent("collagen", "optional", sym.muscleBuilding);
  }
  if (hasComplaint("weight-management-goal")) {
    addIfAbsent("fiber-psyllium", "recommended", sym.weightGoal);
    addIfAbsent("berberine", "recommended", sym.weightGoal);
  }
  if (hasComplaint("gym-performance")) {
    bumpPriority("creatine", "recommended", sym.gymPerformance);
    bumpPriority("electrolytes", "recommended", sym.gymPerformance);
    addIfAbsent("magnesium", "optional", sym.gymPerformance);
  }

  // Attention & Focus
  if (hasComplaint("attention-focus")) {
    bumpPriority("omega-3", "recommended", sym.attention);
    addIfAbsent("l-theanine", "recommended", sym.attention);
    addIfAbsent("vitamin-b12", "optional", sym.attention);
  }

  // Appetite
  if (hasComplaint("poor-appetite")) {
    bumpPriority("zinc", "recommended", sym.poorAppetite);
  }
  if (hasComplaint("sugar-cravings")) {
    addIfAbsent("berberine", "recommended", sym.sugarCravings);
    bumpPriority("fiber-psyllium", "recommended", sym.sugarCravings);
  }
  if (hasComplaint("poor-satiety")) {
    bumpPriority("fiber-psyllium", "recommended", sym.poorSatiety);
    addIfAbsent("berberine", "optional", sym.poorSatiety);
  }

  if (age === "40-50" || age === "50-60") {
    if (candidates.has("coq10")) {
      const existing = candidates.get("coq10")!;
      candidates.set("coq10", {
        ...existing,
        reason: existing.reason + t.reasons.coq10AgeSuffix,
      });
    }
  }

  const removedForSafety: { name: string; reason: string }[] = [];
  candidates.forEach((_, id) => {
    const drugInteractions = checkDrugInteractions(id, medications);
    const highSeverity = drugInteractions.filter((i) => i.severity === "high");
    const isBeneficial = highSeverity.length === 0 || (id === "coq10" && hasMedication("statins") && !hasMedication("anti-neoplastic"));
    if (!isBeneficial && highSeverity.length > 0) {
      const supp = supplements.find((s) => s.id === id);
      removedForSafety.push({ name: supp?.name || id, reason: highSeverity[0].action });
      candidates.delete(id);
    }
  });

  if (allergies.includes("fish") || allergies.includes("shellfish")) {
    const omega = candidates.get("omega-3");
    if (omega) omega.reason += t.reasons.algaeAllergySuffix;
  }

  const priorityOrder = { essential: 0, recommended: 1, optional: 2 };
  const sorted = Array.from(candidates.entries())
    .sort(([, a], [, b]) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, maxSupplements);

  const stackIds = sorted.map(([id]) => id);
  const stackInteractions = checkStackInteractions(stackIds);

  const stack: RecommendedSupplement[] = sorted
    .map(([id, meta]) => {
      const supplement = supplements.find((s) => s.id === id);
      if (!supplement) return null;

      const warnings = [
        ...checkDrugInteractions(id, medications),
        ...stackInteractions.filter((i) => i.substanceAId === id),
      ];

      let doseAdjustment: string | undefined;
      if (id === "vitamin-d3" && sun === "minimal")
        doseAdjustment = t.doseAdjustments.vitaminD3LowSun;
      if (id === "vitamin-b12" && diet === "vegan")
        doseAdjustment = t.doseAdjustments.b12Vegan;
      if (id === "magnesium" && exercise === "heavy")
        doseAdjustment = t.doseAdjustments.magnesiumHeavy;
      if (id === "electrolytes" && diet === "keto")
        doseAdjustment = t.doseAdjustments.electrolytesKeto;

      return { supplement, reason: meta.reason, priority: meta.priority, doseAdjustment, warnings };
    })
    .filter(Boolean) as RecommendedSupplement[];

  const timingSchedule = buildTimingSchedule(stack, t);

  const essentialCount = stack.filter((s) => s.priority === "essential").length;
  const totalWarnings = stack.reduce((sum, s) => sum + s.warnings.length, 0);

  const summary = t.summary(
    stack.length,
    fmtGoal(primaryGoal),
    secondaryGoal && secondaryGoal !== "none" ? fmtGoal(secondaryGoal) : null,
    essentialCount,
    totalWarnings
  );

  const disclaimers: string[] = [...t.disclaimers.base];

  if (removedForSafety.length > 0) {
    disclaimers.push(
      t.disclaimers.removedSupplements(
        removedForSafety.length,
        removedForSafety.map((r) => r.name).join(", ")
      )
    );
  }

  if (hasMedication("blood-thinners")) {
    disclaimers.push(t.disclaimers.bloodThinners);
  }

  return { stack, interactions: stackInteractions, timingSchedule, summary, disclaimers };
}

function buildTimingSchedule(
  stack: RecommendedSupplement[],
  t: ReturnType<typeof getT>["engine"]
): TimingSlot[] {
  const morning: TimingSlot = { time: t.timingSlots.morning, emoji: "🌅", supplements: [] };
  const midMorning: TimingSlot = { time: t.timingSlots.midMorning, emoji: "☀️", supplements: [] };
  const lunch: TimingSlot = { time: t.timingSlots.lunch, emoji: "🍽️", supplements: [] };
  const evening: TimingSlot = { time: t.timingSlots.evening, emoji: "🌙", supplements: [] };
  const anytime: TimingSlot = { time: t.timingSlots.anytime, emoji: "⏰", supplements: [] };

  stack.forEach(({ supplement: s, doseAdjustment }) => {
    const dose = doseAdjustment || s.standardDose;
    switch (s.id) {
      case "vitamin-d3": case "vitamin-k2": case "coq10": case "vitamin-b12": case "iron": case "vitamin-c":
        morning.supplements.push({ name: s.name, dose, note: s.id === "iron" ? t.timingNotes.iron : undefined });
        break;
      case "fiber-psyllium": case "probiotics":
        midMorning.supplements.push({ name: s.name, dose, note: s.id === "fiber-psyllium" ? t.timingNotes.fiber : undefined });
        break;
      case "omega-3": case "curcumin": case "zinc": case "berberine":
        lunch.supplements.push({ name: s.name, dose, note: s.takeWithFood ? t.timingNotes.takeWithFood : undefined });
        break;
      case "magnesium": case "l-theanine": case "ashwagandha": case "melatonin":
        evening.supplements.push({ name: s.name, dose });
        break;
      case "creatine": case "collagen": case "nac": case "electrolytes":
        anytime.supplements.push({ name: s.name, dose });
        break;
      default:
        morning.supplements.push({ name: s.name, dose });
    }
  });

  const schedule: TimingSlot[] = [];
  [morning, midMorning, lunch, evening, anytime].forEach((slot) => {
    if (slot.supplements.length > 0) schedule.push(slot);
  });
  return schedule;
}
