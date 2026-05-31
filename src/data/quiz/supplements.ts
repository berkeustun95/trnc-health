// ═══════════════════════════════════════════════════════════════
// SUPPLEMENT DATABASE
// This is the single source of truth for all supplement data.
// It powers the quiz, results, interaction checker, and will
// migrate directly into the mobile app (#15).
// ═══════════════════════════════════════════════════════════════

export type EvidenceGrade = "A" | "B+" | "B" | "C";
export type CostTier = "$" | "$$" | "$$$";
export type SupplementCategory =
  | "Vitamin"
  | "Mineral"
  | "Essential Fatty Acid"
  | "Amino Acid"
  | "Adaptogen"
  | "Anti-inflammatory"
  | "Protein"
  | "Performance"
  | "Gut Health"
  | "Antioxidant"
  | "Hormone"
  | "Botanical"
  | "Mineral Complex"
  | "Digestive";

export interface Supplement {
  id: string;
  name: string;
  category: SupplementCategory;
  primaryBenefit: string;
  secondaryBenefits: string[];
  bestForm: string;
  standardDose: string;
  maxDose: string;
  timing: string;
  takeWithFood: boolean | "optional";
  mechanism: string;
  evidenceGrade: EvidenceGrade;
  costTier: CostTier;
  pharmacistNote: string;
  tags: string[]; // for search/filtering in the app
}

export const supplements: Supplement[] = [
  {
    id: "vitamin-d3",
    name: "Vitamin D3",
    category: "Vitamin",
    primaryBenefit: "Bone health & Immunity",
    secondaryBenefits: ["Mood", "Hormone support", "Muscle function"],
    bestForm: "Cholecalciferol (D3), NOT D2",
    standardDose: "2,000–4,000 IU/day",
    maxDose: "10,000 IU/day",
    timing: "Morning with breakfast",
    takeWithFood: true,
    mechanism:
      "Regulates calcium absorption; modulates immune T-cells; supports over 1,000 gene expressions.",
    evidenceGrade: "A",
    costTier: "$$",
    pharmacistNote:
      "Pair with K2 (MK-7) for proper calcium routing. Test blood levels first if possible. Target 40–60 ng/mL.",
    tags: ["bone", "immunity", "mood", "hormone", "essential", "fat-soluble"],
  },
  {
    id: "magnesium",
    name: "Magnesium",
    category: "Mineral",
    primaryBenefit: "Sleep & Muscle relaxation",
    secondaryBenefits: ["Stress relief", "Headache prevention", "Energy metabolism"],
    bestForm: "Glycinate (sleep), Threonate (cognitive), Citrate (gut)",
    standardDose: "300–400 mg elemental/day",
    maxDose: "500 mg elemental/day",
    timing: "Evening (glycinate) or split AM/PM",
    takeWithFood: "optional",
    mechanism:
      "Cofactor in 300+ enzymatic reactions; GABA receptor agonist for calming; essential for ATP production.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Oxide form has poor absorption (~4%). Glycinate is the gold standard. Most adults are deficient.",
    tags: ["sleep", "stress", "muscle", "energy", "essential", "mineral"],
  },
  {
    id: "omega-3",
    name: "Omega-3 (Fish Oil)",
    category: "Essential Fatty Acid",
    primaryBenefit: "Heart health & Inflammation",
    secondaryBenefits: ["Brain function", "Joint health", "Mood", "Skin"],
    bestForm: "Triglyceride form (NOT ethyl ester); high EPA+DHA ratio",
    standardDose: "1,000–2,000 mg EPA+DHA/day",
    maxDose: "3,000 mg EPA+DHA/day",
    timing: "With largest meal",
    takeWithFood: true,
    mechanism:
      "EPA reduces inflammatory prostaglandins; DHA is a structural component of brain cell membranes.",
    evidenceGrade: "A",
    costTier: "$$",
    pharmacistNote:
      "Check for IFOS certification. Burpless = enteric coated. Algae-based for vegans.",
    tags: ["heart", "brain", "inflammation", "joints", "mood", "skin", "essential"],
  },
  {
    id: "probiotics",
    name: "Probiotics",
    category: "Gut Health",
    primaryBenefit: "Digestive health",
    secondaryBenefits: ["Immunity", "Mood", "Skin", "Nutrient absorption"],
    bestForm: "Multi-strain (Lactobacillus + Bifidobacterium); strain-specific matters",
    standardDose: "10–50 billion CFU/day",
    maxDose: "100 billion CFU/day",
    timing: "Morning on empty stomach or before bed",
    takeWithFood: false,
    mechanism:
      "Colonize gut; outcompete pathogens; produce short-chain fatty acids; strengthen gut-immune axis.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "Strain specificity matters: L. rhamnosus GG (gut), B. longum (mood). Refrigerated > shelf-stable usually.",
    tags: ["gut", "digestion", "immunity", "mood", "skin"],
  },
  {
    id: "vitamin-b12",
    name: "Vitamin B12",
    category: "Vitamin",
    primaryBenefit: "Energy & Nerve function",
    secondaryBenefits: ["Mood", "Cognitive function", "Red blood cell formation"],
    bestForm: "Methylcobalamin or Adenosylcobalamin (NOT cyanocobalamin)",
    standardDose: "1,000–2,500 mcg/day",
    maxDose: "5,000 mcg/day",
    timing: "Morning",
    takeWithFood: false,
    mechanism:
      "Essential methyl donor; myelin sheath maintenance; homocysteine metabolism.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Critical for vegans/vegetarians. Metformin depletes B12. Sublingual bypasses gut absorption issues.",
    tags: ["energy", "nerve", "mood", "cognitive", "vegan-essential"],
  },
  {
    id: "zinc",
    name: "Zinc",
    category: "Mineral",
    primaryBenefit: "Immunity & Skin health",
    secondaryBenefits: ["Testosterone support", "Wound healing", "Taste/smell"],
    bestForm: "Zinc picolinate or bisglycinate (NOT oxide)",
    standardDose: "15–30 mg/day",
    maxDose: "40 mg/day",
    timing: "With food (prevents nausea)",
    takeWithFood: true,
    mechanism: "Cofactor for 100+ enzymes; critical for immune cell signaling and DNA synthesis.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "MUST balance with copper (2 mg Cu per 15 mg Zn). Don't take with iron or calcium — they compete for absorption.",
    tags: ["immunity", "skin", "testosterone", "mineral", "essential"],
  },
  {
    id: "ashwagandha",
    name: "Ashwagandha",
    category: "Adaptogen",
    primaryBenefit: "Stress reduction",
    secondaryBenefits: ["Sleep quality", "Thyroid support", "Testosterone", "Endurance"],
    bestForm: "KSM-66 (root extract) or Sensoril (root+leaf)",
    standardDose: "300–600 mg/day (KSM-66)",
    maxDose: "1,200 mg/day",
    timing: "Evening (for sleep) or morning (for stress)",
    takeWithFood: "optional",
    mechanism:
      "Modulates HPA axis; reduces cortisol 25–30%; GABAergic activity promotes calm.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "Avoid with thyroid medications (can increase thyroid hormone). Nightshade family. Cycle 8 weeks on, 2 off.",
    tags: ["stress", "sleep", "adaptogen", "testosterone", "endurance"],
  },
  {
    id: "curcumin",
    name: "Curcumin",
    category: "Anti-inflammatory",
    primaryBenefit: "Joint pain & Inflammation",
    secondaryBenefits: ["Cognitive support", "Liver health", "Heart health", "Skin"],
    bestForm: "With piperine (BioPerine) or liposomal or Meriva (phytosome)",
    standardDose: "500–1,000 mg/day",
    maxDose: "2,000 mg/day",
    timing: "With meals",
    takeWithFood: true,
    mechanism:
      "Inhibits NF-kB inflammatory pathway; potent antioxidant. Plain turmeric is only 3% curcumin.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "Piperine increases absorption 2,000%. Plain turmeric capsules are essentially useless therapeutically.",
    tags: ["inflammation", "joints", "cognitive", "liver", "heart"],
  },
  {
    id: "collagen",
    name: "Collagen",
    category: "Protein",
    primaryBenefit: "Skin & Joint support",
    secondaryBenefits: ["Hair", "Nails", "Gut lining", "Bone density"],
    bestForm: "Hydrolyzed peptides (Type I+III for skin; Type II for joints)",
    standardDose: "10–15 g/day",
    maxDose: "30 g/day",
    timing: "Morning (empty stomach) or in coffee",
    takeWithFood: "optional",
    mechanism:
      "Provides glycine, proline, hydroxyproline for connective tissue synthesis. Requires Vitamin C as cofactor.",
    evidenceGrade: "B",
    costTier: "$$",
    pharmacistNote:
      "Must combine with Vitamin C for collagen synthesis. Marine > bovine for skin. Results take 8–12 weeks.",
    tags: ["skin", "joints", "hair", "nails", "gut", "bone"],
  },
  {
    id: "creatine",
    name: "Creatine",
    category: "Performance",
    primaryBenefit: "Muscle strength & Power",
    secondaryBenefits: ["Cognitive function", "Recovery", "Hydration"],
    bestForm: "Creatine monohydrate (Creapure brand)",
    standardDose: "3–5 g/day",
    maxDose: "10 g/day (loading phase only)",
    timing: "Any time — daily consistency matters most",
    takeWithFood: "optional",
    mechanism:
      "Regenerates ATP in muscle cells; increases phosphocreatine stores; emerging cognitive benefits.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Most researched supplement in history. No need to cycle. No need to load. May cause minor water retention initially.",
    tags: ["performance", "muscle", "cognitive", "recovery", "essential"],
  },
  {
    id: "vitamin-c",
    name: "Vitamin C",
    category: "Vitamin",
    primaryBenefit: "Immunity & Antioxidant",
    secondaryBenefits: ["Collagen synthesis", "Iron absorption", "Skin health"],
    bestForm: "Ascorbic acid (budget) or liposomal (premium absorption)",
    standardDose: "500–1,000 mg/day",
    maxDose: "2,000 mg/day",
    timing: "Split doses (morning + afternoon)",
    takeWithFood: "optional",
    mechanism:
      "Electron donor; cofactor for collagen hydroxylation; enhances neutrophil function.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Megadosing (5g+) causes GI distress. Take with iron-rich foods to boost iron absorption. Smokers need 35 mg more/day.",
    tags: ["immunity", "antioxidant", "collagen", "iron-absorption", "skin"],
  },
  {
    id: "iron",
    name: "Iron",
    category: "Mineral",
    primaryBenefit: "Energy & Blood health",
    secondaryBenefits: ["Cognitive function", "Exercise performance"],
    bestForm: "Bisglycinate (gentle, high absorption) NOT ferrous sulfate",
    standardDose: "18–27 mg/day (women), 8 mg/day (men)",
    maxDose: "45 mg/day",
    timing: "Empty stomach with Vitamin C",
    takeWithFood: false,
    mechanism: "Oxygen transport via hemoglobin; mitochondrial electron transport chain.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "DON'T supplement without confirmed deficiency (blood test). Never take with calcium, zinc, or coffee. Separate from thyroid meds by 4 hours.",
    tags: ["energy", "blood", "cognitive", "performance", "women"],
  },
  {
    id: "l-theanine",
    name: "L-Theanine",
    category: "Amino Acid",
    primaryBenefit: "Calm focus & Anxiety relief",
    secondaryBenefits: ["Sleep support", "Cognitive performance", "Stress"],
    bestForm: "Pure L-Theanine (Suntheanine brand premium)",
    standardDose: "100–200 mg/day",
    maxDose: "400 mg/day",
    timing: "Morning with caffeine, or evening for sleep",
    takeWithFood: false,
    mechanism:
      "Increases alpha brain waves; modulates GABA, serotonin, and dopamine without drowsiness.",
    evidenceGrade: "B+",
    costTier: "$",
    pharmacistNote:
      "200 mg L-theanine + 100 mg caffeine = the nootropic sweet spot. No drowsiness. Safe with most medications.",
    tags: ["focus", "anxiety", "sleep", "cognitive", "stress", "nootropic"],
  },
  {
    id: "vitamin-k2",
    name: "Vitamin K2",
    category: "Vitamin",
    primaryBenefit: "Bone & Cardiovascular health",
    secondaryBenefits: ["Calcium metabolism", "Dental health"],
    bestForm: "MK-7 (menaquinone-7) — longest half-life",
    standardDose: "100–200 mcg/day",
    maxDose: "300 mcg/day",
    timing: "Morning with D3 and food",
    takeWithFood: true,
    mechanism:
      "Activates osteocalcin (bones) and MGP (arteries) to direct calcium where it belongs.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "CRITICAL if taking Vitamin D — D increases calcium absorption, K2 directs where it goes. CONTRAINDICATED with warfarin.",
    tags: ["bone", "cardiovascular", "calcium", "essential-pairing"],
  },
  {
    id: "coq10",
    name: "CoQ10",
    category: "Antioxidant",
    primaryBenefit: "Heart health & Cellular energy",
    secondaryBenefits: ["Statin side effect relief", "Anti-aging", "Fertility"],
    bestForm: "Ubiquinol (active form, better over age 40) vs Ubiquinone",
    standardDose: "100–200 mg/day",
    maxDose: "400 mg/day",
    timing: "With meal containing fat",
    takeWithFood: true,
    mechanism:
      "Mitochondrial electron transport chain; powerful lipid-soluble antioxidant.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "ESSENTIAL for anyone on statins — statins deplete CoQ10 causing muscle pain. Ubiquinol form preferred after age 40.",
    tags: ["heart", "energy", "statin-companion", "anti-aging", "fertility"],
  },
  {
    id: "melatonin",
    name: "Melatonin",
    category: "Hormone",
    primaryBenefit: "Sleep onset",
    secondaryBenefits: ["Jet lag recovery", "Circadian rhythm reset"],
    bestForm: "Low-dose (0.5–1 mg); extended release for sleep maintenance",
    standardDose: "0.5–3 mg/night",
    maxDose: "5 mg/night",
    timing: "30–60 min before bed, in darkness",
    takeWithFood: false,
    mechanism: "Endogenous circadian rhythm regulator; MT1/MT2 receptor agonist.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Less is more — 0.5 mg often works better than 5 mg. Not for long-term daily use without guidance. Can worsen depression in some.",
    tags: ["sleep", "circadian", "jet-lag", "short-term"],
  },
  {
    id: "nac",
    name: "NAC (N-Acetyl Cysteine)",
    category: "Amino Acid",
    primaryBenefit: "Liver support & Detox",
    secondaryBenefits: ["Respiratory health", "Glutathione precursor", "Mental health"],
    bestForm: "NAC standard — take on empty stomach",
    standardDose: "600–1,200 mg/day",
    maxDose: "1,800 mg/day",
    timing: "Morning on empty stomach",
    takeWithFood: false,
    mechanism:
      "Rate-limiting precursor to glutathione (master antioxidant); mucolytic; modulates glutamate.",
    evidenceGrade: "B+",
    costTier: "$",
    pharmacistNote:
      "Proven for acetaminophen toxicity. Emerging evidence for OCD/trichotillomania. Take with Vitamin C to prevent oxidation.",
    tags: ["liver", "detox", "antioxidant", "respiratory", "mental-health"],
  },
  {
    id: "berberine",
    name: "Berberine",
    category: "Botanical",
    primaryBenefit: "Blood sugar regulation",
    secondaryBenefits: ["Cholesterol", "Gut health", "Weight management"],
    bestForm: "Berberine HCl (standard) or dihydroberberine (better absorption)",
    standardDose: "500 mg 2–3x/day with meals",
    maxDose: "1,500 mg/day",
    timing: "With meals (reduces GI side effects)",
    takeWithFood: true,
    mechanism:
      "Activates AMPK pathway; comparable to metformin in some studies for glucose control.",
    evidenceGrade: "B+",
    costTier: "$$",
    pharmacistNote:
      "STRONG drug interactions — mimics metformin mechanism. Don't combine with metformin without MD oversight. Can lower blood pressure.",
    tags: ["blood-sugar", "cholesterol", "weight", "gut", "caution-drugs"],
  },
  {
    id: "electrolytes",
    name: "Electrolytes",
    category: "Mineral Complex",
    primaryBenefit: "Hydration & Performance",
    secondaryBenefits: ["Cramp prevention", "Keto support", "Recovery"],
    bestForm: "Balanced ratio: Na 1000mg, K 200mg, Mg 60mg per liter",
    standardDose: "1–2 servings/day based on activity",
    maxDose: "Varies by mineral",
    timing: "During/after exercise or morning",
    takeWithFood: false,
    mechanism:
      "Maintains osmotic balance; nerve impulse conduction; muscle contraction.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Critical for fasting, keto, heavy sweating. Most commercial sports drinks have too much sugar, too little sodium.",
    tags: ["hydration", "performance", "keto", "exercise", "recovery"],
  },
  {
    id: "fiber-psyllium",
    name: "Fiber (Psyllium Husk)",
    category: "Digestive",
    primaryBenefit: "Gut regularity & Cholesterol",
    secondaryBenefits: ["Blood sugar control", "Satiety", "Microbiome support"],
    bestForm: "Psyllium husk (soluble) or acacia fiber (prebiotic)",
    standardDose: "5–10 g/day, build up gradually",
    maxDose: "30 g/day",
    timing: "Before meals with lots of water",
    takeWithFood: true,
    mechanism:
      "Gel-forming soluble fiber; binds bile acids (lowers cholesterol); feeds beneficial bacteria.",
    evidenceGrade: "A",
    costTier: "$",
    pharmacistNote:
      "Start low (3 g) and increase slowly to avoid bloating. MUST drink adequate water. Separate from medications by 2 hours.",
    tags: ["gut", "cholesterol", "blood-sugar", "weight", "digestion"],
  },
];

export function getSupplementById(id: string): Supplement | undefined {
  return supplements.find((s) => s.id === id);
}

export function getSupplementsByTag(tag: string): Supplement[] {
  return supplements.filter((s) => s.tags.includes(tag));
}
