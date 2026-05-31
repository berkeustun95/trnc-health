// ═══════════════════════════════════════════════════════════════
// INTERACTION DATABASE
// This is the pharmacist's secret weapon — no influencer quiz
// does this. Migrates directly into the app's interaction checker.
// ═══════════════════════════════════════════════════════════════

export type Severity = "high" | "moderate" | "low";

export interface Interaction {
  id: string;
  substanceA: string;
  substanceAId: string; // links to supplement.id
  substanceB: string;
  substanceBType: "drug" | "supplement";
  medicationId?: string; // links to medication option id from quiz
  severity: Severity;
  mechanism: string;
  action: string;
}

export const interactions: Interaction[] = [
  // ── BLOOD THINNER INTERACTIONS ──
  {
    id: "omega3-warfarin",
    substanceA: "Omega-3 (Fish Oil)",
    substanceAId: "omega-3",
    substanceB: "Blood Thinners (Warfarin)",
    substanceBType: "drug",
    medicationId: "blood-thinners",
    severity: "high",
    mechanism: "Additive anticoagulant effect — both inhibit platelet aggregation.",
    action: "AVOID or use only under doctor supervision. Monitor INR closely.",
  },
  {
    id: "k2-warfarin",
    substanceA: "Vitamin K2",
    substanceAId: "vitamin-k2",
    substanceB: "Blood Thinners (Warfarin)",
    substanceBType: "drug",
    medicationId: "blood-thinners",
    severity: "high",
    mechanism: "K2 activates clotting factors that warfarin suppresses — directly opposes the drug.",
    action: "CONTRAINDICATED. Do not combine. K2 will reduce warfarin effectiveness.",
  },
  {
    id: "curcumin-bloodthinners",
    substanceA: "Curcumin",
    substanceAId: "curcumin",
    substanceB: "Blood Thinners",
    substanceBType: "drug",
    medicationId: "blood-thinners",
    severity: "moderate",
    mechanism: "Curcumin has mild antiplatelet activity.",
    action: "Monitor for unusual bleeding. Discontinue 2 weeks before surgery.",
  },

  // ── STATIN INTERACTIONS ──
  {
    id: "coq10-statins",
    substanceA: "CoQ10",
    substanceAId: "coq10",
    substanceB: "Statins",
    substanceBType: "drug",
    medicationId: "statins",
    severity: "low",
    mechanism: "Statins deplete CoQ10 — this is a BENEFICIAL interaction. Supplementing CoQ10 addresses statin-induced deficiency.",
    action: "RECOMMENDED combination. CoQ10 (Ubiquinol) helps prevent statin muscle pain.",
  },

  // ── THYROID MEDICATION INTERACTIONS ──
  {
    id: "iron-thyroid",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "Thyroid Medication (Levothyroxine)",
    substanceBType: "drug",
    medicationId: "thyroid",
    severity: "high",
    mechanism: "Iron chelates thyroid hormone in the GI tract, reducing absorption by 50–75%.",
    action: "Separate by at least 4 hours. Take thyroid med first thing AM, iron at lunch/dinner.",
  },
  {
    id: "ashwagandha-thyroid",
    substanceA: "Ashwagandha",
    substanceAId: "ashwagandha",
    substanceB: "Thyroid Medication",
    substanceBType: "drug",
    medicationId: "thyroid",
    severity: "moderate",
    mechanism: "Ashwagandha can increase T3 and T4 thyroid hormone production.",
    action: "Use with caution. May require thyroid dose adjustment. Discuss with your doctor.",
  },

  // ── SSRI / ANTIDEPRESSANT INTERACTIONS ──
  {
    id: "ashwagandha-ssri",
    substanceA: "Ashwagandha",
    substanceAId: "ashwagandha",
    substanceB: "Antidepressants (SSRIs)",
    substanceBType: "drug",
    medicationId: "ssri",
    severity: "moderate",
    mechanism: "Additive CNS effects — both modulate serotonergic and GABAergic pathways.",
    action: "Start with lower ashwagandha dose. Monitor for excessive drowsiness or mood changes.",
  },

  // ── METFORMIN INTERACTIONS ──
  {
    id: "berberine-metformin",
    substanceA: "Berberine",
    substanceAId: "berberine",
    substanceB: "Metformin",
    substanceBType: "drug",
    medicationId: "metformin",
    severity: "high",
    mechanism: "Both activate AMPK pathway and lower blood glucose — additive hypoglycemia risk.",
    action: "Do NOT combine without doctor supervision. Risk of dangerous hypoglycemia.",
  },

  // ── PPI INTERACTIONS ──
  {
    id: "iron-ppi",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "PPIs (Acid Reflux Meds)",
    substanceBType: "drug",
    medicationId: "ppi",
    severity: "moderate",
    mechanism: "PPIs reduce stomach acid needed for iron absorption.",
    action: "Use bisglycinate form (less dependent on stomach acid). Consider higher dose.",
  },

  // ── SUPPLEMENT-SUPPLEMENT INTERACTIONS ──
  {
    id: "iron-calcium",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "Calcium",
    substanceBType: "supplement",
    severity: "moderate",
    mechanism: "Compete for the same absorption transporters (DMT1) in the small intestine.",
    action: "Take at different times of day. Iron in AM, Calcium in PM.",
  },
  {
    id: "iron-zinc",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "Zinc",
    substanceBType: "supplement",
    severity: "moderate",
    mechanism: "Compete for absorption via DMT1 transporter at supplemental doses.",
    action: "Take at different meals. Iron with breakfast + Vitamin C; Zinc with dinner.",
  },
  {
    id: "zinc-copper",
    substanceA: "Zinc",
    substanceAId: "zinc",
    substanceB: "Copper (depletion)",
    substanceBType: "supplement",
    severity: "moderate",
    mechanism: "Zinc induces metallothionein which binds copper, causing deficiency over time.",
    action: "Supplement copper (2 mg) for every 15 mg zinc. Or use a zinc + copper combo product.",
  },

  // ── ANTIHISTAMINE INTERACTIONS ──
  {
    id: "antihistamines-melatonin",
    substanceA: "Melatonin",
    substanceAId: "melatonin",
    substanceB: "Antihistamines (cetirizine, loratadine)",
    substanceBType: "drug",
    medicationId: "antihistamines",
    severity: "moderate",
    mechanism: "Additive CNS depression and drowsiness.",
    action: "Reduce melatonin dose or avoid combining. Start with 0.5 mg maximum.",
  },
  {
    id: "antihistamines-ltheanine",
    substanceA: "L-Theanine",
    substanceAId: "l-theanine",
    substanceB: "Antihistamines",
    substanceBType: "drug",
    medicationId: "antihistamines",
    severity: "low",
    mechanism: "Mild additive sedation.",
    action: "Monitor for excessive drowsiness.",
  },

  // ── CORTICOSTEROID INTERACTIONS ──
  {
    id: "corticosteroids-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Corticosteroids (prednisone)",
    substanceBType: "drug",
    medicationId: "corticosteroids",
    severity: "low",
    mechanism: "Corticosteroids deplete Vitamin D. Supplementation addresses drug-induced deficiency.",
    action: "RECOMMENDED supplementation. Monitor levels.",
  },
  {
    id: "corticosteroids-zinc",
    substanceA: "Zinc",
    substanceAId: "zinc",
    substanceB: "Corticosteroids",
    substanceBType: "drug",
    medicationId: "corticosteroids",
    severity: "low",
    mechanism: "Corticosteroids increase zinc excretion over time.",
    action: "Supplementation recommended.",
  },
  {
    id: "corticosteroids-magnesium",
    substanceA: "Magnesium",
    substanceAId: "magnesium",
    substanceB: "Corticosteroids",
    substanceBType: "drug",
    medicationId: "corticosteroids",
    severity: "low",
    mechanism: "Corticosteroids increase magnesium excretion.",
    action: "Supplementation recommended.",
  },

  // ── OSTEOPOROSIS MED INTERACTIONS ──
  {
    id: "osteoporosis-iron",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "Osteoporosis Meds (bisphosphonates)",
    substanceBType: "drug",
    medicationId: "osteoporosis-meds",
    severity: "high",
    mechanism: "Iron reduces bisphosphonate absorption significantly.",
    action: "Separate by at least 2 hours. Take bisphosphonate first thing AM on empty stomach.",
  },
  {
    id: "osteoporosis-magnesium",
    substanceA: "Magnesium",
    substanceAId: "magnesium",
    substanceB: "Osteoporosis Meds (bisphosphonates)",
    substanceBType: "drug",
    medicationId: "osteoporosis-meds",
    severity: "high",
    mechanism: "Magnesium chelates bisphosphonates, reducing drug absorption.",
    action: "Separate by at least 2 hours. Take bisphosphonate first thing AM on empty stomach.",
  },
  {
    id: "osteoporosis-vitamink2",
    substanceA: "Vitamin K2",
    substanceAId: "vitamin-k2",
    substanceB: "Osteoporosis Meds (bisphosphonates)",
    substanceBType: "drug",
    medicationId: "osteoporosis-meds",
    severity: "moderate",
    mechanism: "Calcium-containing supplements and K2 can reduce bisphosphonate absorption if taken simultaneously.",
    action: "Take bisphosphonate first thing AM on empty stomach. Take K2 and calcium at a different meal.",
  },

  // ── SLEEP AID INTERACTIONS ──
  {
    id: "sleep-aids-melatonin",
    substanceA: "Melatonin",
    substanceAId: "melatonin",
    substanceB: "Sleep Aids (zolpidem, benzodiazepines)",
    substanceBType: "drug",
    medicationId: "sleep-aids",
    severity: "high",
    mechanism: "Additive CNS depression — both cause sedation via overlapping pathways.",
    action: "Do NOT combine without doctor supervision. Risk of excessive sedation.",
  },
  {
    id: "sleep-aids-ashwagandha",
    substanceA: "Ashwagandha",
    substanceAId: "ashwagandha",
    substanceB: "Sleep Aids (benzodiazepines)",
    substanceBType: "drug",
    medicationId: "sleep-aids",
    severity: "moderate",
    mechanism: "Additive sedation via GABAergic pathways.",
    action: "Avoid combining or significantly reduce ashwagandha dose. Monitor for excessive drowsiness.",
  },
  {
    id: "sleep-aids-ltheanine",
    substanceA: "L-Theanine",
    substanceAId: "l-theanine",
    substanceB: "Sleep Aids",
    substanceBType: "drug",
    medicationId: "sleep-aids",
    severity: "moderate",
    mechanism: "Additive calming effect — may cause excessive drowsiness.",
    action: "Monitor for excessive drowsiness. Reduce dose if needed.",
  },

  // ── ANTIBIOTIC INTERACTIONS ──
  {
    id: "antibiotics-probiotics",
    substanceA: "Probiotics",
    substanceAId: "probiotics",
    substanceB: "Antibiotics (current course)",
    substanceBType: "drug",
    medicationId: "antibiotics",
    severity: "moderate",
    mechanism: "Antibiotics kill probiotic bacteria, reducing efficacy if taken simultaneously.",
    action: "Take probiotics 2–3 hours AFTER antibiotic dose. Continue 2 weeks after course ends.",
  },
  {
    id: "antibiotics-zinc",
    substanceA: "Zinc",
    substanceAId: "zinc",
    substanceB: "Antibiotics (fluoroquinolones, tetracyclines)",
    substanceBType: "drug",
    medicationId: "antibiotics",
    severity: "moderate",
    mechanism: "Zinc reduces absorption of fluoroquinolone and tetracycline antibiotics.",
    action: "Separate by at least 2 hours.",
  },
  {
    id: "antibiotics-iron",
    substanceA: "Iron",
    substanceAId: "iron",
    substanceB: "Antibiotics",
    substanceBType: "drug",
    medicationId: "antibiotics",
    severity: "moderate",
    mechanism: "Iron reduces antibiotic absorption.",
    action: "Separate by at least 2 hours.",
  },
  {
    id: "antibiotics-magnesium",
    substanceA: "Magnesium",
    substanceAId: "magnesium",
    substanceB: "Antibiotics (fluoroquinolones)",
    substanceBType: "drug",
    medicationId: "antibiotics",
    severity: "moderate",
    mechanism: "Magnesium chelates fluoroquinolones, reducing antibiotic absorption.",
    action: "Separate by at least 2 hours.",
  },

  // ── ANTIFUNGAL INTERACTIONS ──
  {
    id: "antifungals-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Antifungals (azoles)",
    substanceBType: "drug",
    medicationId: "antifungals",
    severity: "low",
    mechanism: "Some azole antifungals may affect Vitamin D metabolism via CYP enzyme inhibition.",
    action: "Monitor Vitamin D levels. Supplementation may still be appropriate.",
  },

  // ── IMMUNOSUPPRESSANT INTERACTIONS ──
  {
    id: "immunosuppressants-curcumin",
    substanceA: "Curcumin",
    substanceAId: "curcumin",
    substanceB: "Immunosuppressants",
    substanceBType: "drug",
    medicationId: "immunosuppressants",
    severity: "high",
    mechanism: "Curcumin modulates immune function and may interfere with immunosuppression.",
    action: "AVOID. Do not use curcumin while on immunosuppressants.",
  },
  {
    id: "immunosuppressants-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Immunosuppressants",
    substanceBType: "drug",
    medicationId: "immunosuppressants",
    severity: "moderate",
    mechanism: "Vitamin D modulates immune response — may affect immunosuppression efficacy.",
    action: "Use only under doctor supervision.",
  },
  {
    id: "immunosuppressants-omega3",
    substanceA: "Omega-3 (Fish Oil)",
    substanceAId: "omega-3",
    substanceB: "Immunosuppressants",
    substanceBType: "drug",
    medicationId: "immunosuppressants",
    severity: "low",
    mechanism: "Mild immune modulation at high doses.",
    action: "Generally safe at standard doses (1–2 g EPA+DHA). Discuss with doctor.",
  },

  // ── SEIZURE MED INTERACTIONS ──
  {
    id: "seizure-meds-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Seizure Medications (anticonvulsants)",
    substanceBType: "drug",
    medicationId: "seizure-meds",
    severity: "low",
    mechanism: "Anticonvulsants deplete Vitamin D via CYP enzyme induction. Supplementation addresses deficiency.",
    action: "RECOMMENDED supplementation. Monitor levels.",
  },
  {
    id: "seizure-meds-vitaminb12",
    substanceA: "Vitamin B12",
    substanceAId: "vitamin-b12",
    substanceB: "Seizure Medications (anticonvulsants)",
    substanceBType: "drug",
    medicationId: "seizure-meds",
    severity: "low",
    mechanism: "Some anticonvulsants deplete B vitamins including B12.",
    action: "Supplementation recommended.",
  },
  {
    id: "seizure-meds-omega3",
    substanceA: "Omega-3 (Fish Oil)",
    substanceAId: "omega-3",
    substanceB: "Seizure Medications",
    substanceBType: "drug",
    medicationId: "seizure-meds",
    severity: "moderate",
    mechanism: "High-dose fish oil may lower seizure threshold in rare cases.",
    action: "Use standard dose only (≤2 g EPA+DHA). Avoid high-dose supplementation.",
  },

  // ── HRT INTERACTIONS ──
  {
    id: "hrt-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Hormone Replacement Therapy (HRT)",
    substanceBType: "drug",
    medicationId: "hrt",
    severity: "low",
    mechanism: "HRT affects calcium metabolism. Vitamin D supports bone health alongside HRT.",
    action: "RECOMMENDED supplementation for bone health support.",
  },
  {
    id: "hrt-magnesium",
    substanceA: "Magnesium",
    substanceAId: "magnesium",
    substanceB: "Hormone Replacement Therapy (HRT)",
    substanceBType: "drug",
    medicationId: "hrt",
    severity: "low",
    mechanism: "Magnesium supports hormone balance and bone health alongside HRT.",
    action: "Supplementation recommended.",
  },

  // ── ANTI-ASTHMATIC INTERACTIONS ──
  {
    id: "anti-asthmatic-magnesium",
    substanceA: "Magnesium",
    substanceAId: "magnesium",
    substanceB: "Anti-asthmatic (inhalers, montelukast)",
    substanceBType: "drug",
    medicationId: "anti-asthmatic",
    severity: "low",
    mechanism: "Magnesium has mild bronchodilator properties that may complement anti-asthmatic therapy.",
    action: "Generally safe. May complement therapy.",
  },

  // ── ANTI-NEOPLASTIC INTERACTIONS ──
  {
    id: "anti-neoplastic-nac",
    substanceA: "NAC (N-Acetyl Cysteine)",
    substanceAId: "nac",
    substanceB: "Anti-neoplastic (chemotherapy)",
    substanceBType: "drug",
    medicationId: "anti-neoplastic",
    severity: "high",
    mechanism: "Antioxidants may reduce chemotherapy's oxidative mechanism of action against cancer cells.",
    action: "AVOID all antioxidant supplements during active chemotherapy without oncologist approval.",
  },
  {
    id: "anti-neoplastic-vitaminc",
    substanceA: "Vitamin C",
    substanceAId: "vitamin-c",
    substanceB: "Anti-neoplastic (chemotherapy)",
    substanceBType: "drug",
    medicationId: "anti-neoplastic",
    severity: "high",
    mechanism: "High-dose Vitamin C (antioxidant) may interfere with chemotherapy mechanisms.",
    action: "AVOID during active chemotherapy without oncologist approval.",
  },
  {
    id: "anti-neoplastic-coq10",
    substanceA: "CoQ10",
    substanceAId: "coq10",
    substanceB: "Anti-neoplastic (chemotherapy)",
    substanceBType: "drug",
    medicationId: "anti-neoplastic",
    severity: "high",
    mechanism: "CoQ10 (antioxidant) may interfere with chemotherapy mechanisms.",
    action: "AVOID during active chemotherapy without oncologist approval.",
  },
  {
    id: "anti-neoplastic-curcumin",
    substanceA: "Curcumin",
    substanceAId: "curcumin",
    substanceB: "Anti-neoplastic (chemotherapy)",
    substanceBType: "drug",
    medicationId: "anti-neoplastic",
    severity: "high",
    mechanism: "Curcumin may interfere with chemotherapy. Risk outweighs benefit during active treatment.",
    action: "AVOID during active chemotherapy without oncologist approval.",
  },
  {
    id: "anti-neoplastic-vitamind3",
    substanceA: "Vitamin D3",
    substanceAId: "vitamin-d3",
    substanceB: "Anti-neoplastic (chemotherapy)",
    substanceBType: "drug",
    medicationId: "anti-neoplastic",
    severity: "moderate",
    mechanism: "Some evidence of benefit but studies are mixed. Requires oncologist supervision.",
    action: "Discuss with oncologist before supplementing during active treatment.",
  },
];

export const interactionTranslations: Record<
  string,
  { substanceA: string; substanceB: string; mechanism: string; action: string }
> = {
  "omega3-warfarin": {
    substanceA: "Omega-3 (Balık Yağı)",
    substanceB: "Kan Sulandırıcılar (Warfarin)",
    mechanism: "Kümülatif antikoagülan etki — her ikisi de trombosit agregasyonunu inhibe eder.",
    action: "KAÇININ veya yalnızca doktor gözetiminde kullanın. INR değerini yakından takip edin.",
  },
  "k2-warfarin": {
    substanceA: "K2 Vitamini",
    substanceB: "Kan Sulandırıcılar (Warfarin)",
    mechanism: "K2, warfarinin baskıladığı pıhtılaşma faktörlerini aktive eder — ilacın etkisini doğrudan engeller.",
    action: "KONTRENDİKE. Birlikte kullanmayın. K2, warfarinin etkinliğini azaltır.",
  },
  "curcumin-bloodthinners": {
    substanceA: "Kurkumin",
    substanceB: "Kan Sulandırıcılar",
    mechanism: "Kurkumin hafif trombosit önleyici etki gösterir.",
    action: "Olağandışı kanama belirtilerini izleyin. Ameliyattan 2 hafta önce kesin.",
  },
  "coq10-statins": {
    substanceA: "CoQ10",
    substanceB: "Statinler",
    mechanism: "Statinler CoQ10'u tüketir — bu FAYDA sağlayan bir etkileşimdir. CoQ10 desteği, statine bağlı eksikliği giderir.",
    action: "ÖNERİLEN kombinasyon. CoQ10 (Ubikinol), statine bağlı kas ağrısını önlemeye yardımcı olur.",
  },
  "iron-thyroid": {
    substanceA: "Demir",
    substanceB: "Tiroid İlacı (Levotiroksin)",
    mechanism: "Demir, GI sistemde tiroid hormonunu şelatlayarak emilimini %50–75 azaltır.",
    action: "En az 4 saat ara verin. Tiroid ilacını sabah aç karnına, demiri öğle/akşam alın.",
  },
  "ashwagandha-thyroid": {
    substanceA: "Ashwagandha",
    substanceB: "Tiroid İlacı",
    mechanism: "Ashwagandha, T3 ve T4 tiroid hormonu üretimini artırabilir.",
    action: "Dikkatli kullanın. Tiroid dozu ayarlaması gerekebilir. Doktorunuzla görüşün.",
  },
  "ashwagandha-ssri": {
    substanceA: "Ashwagandha",
    substanceB: "Antidepresanlar (SSRI)",
    mechanism: "Kümülatif MSS etkileri — her ikisi de serotonerjik ve GABAerjik yolları düzenler.",
    action: "Daha düşük ashwagandha dozu ile başlayın. Aşırı uyuşukluk veya ruh hali değişikliklerini izleyin.",
  },
  "berberine-metformin": {
    substanceA: "Berberin",
    substanceB: "Metformin",
    mechanism: "Her ikisi de AMPK yolunu aktive eder ve kan şekerini düşürür — kümülatif hipoglisemi riski.",
    action: "Doktor gözetimi olmadan KESİNLİKLE birleştirmeyin. Tehlikeli hipoglisemi riski mevcuttur.",
  },
  "iron-ppi": {
    substanceA: "Demir",
    substanceB: "PPI'lar (Mide Asidi İlaçları)",
    mechanism: "PPI'lar, demir emilimi için gereken mide asidini azaltır.",
    action: "Bisisglinat formunu kullanın (mide asidine daha az bağımlı). Daha yüksek doz gerekebilir.",
  },
  "iron-calcium": {
    substanceA: "Demir",
    substanceB: "Kalsiyum",
    mechanism: "İnce bağırsakta aynı emilim taşıyıcıları (DMT1) için rekabet ederler.",
    action: "Farklı saatlerde alın. Demir sabah, kalsiyum akşam.",
  },
  "iron-zinc": {
    substanceA: "Demir",
    substanceB: "Çinko",
    mechanism: "Takviye dozlarında DMT1 taşıyıcısı aracılığıyla emilim için rekabet ederler.",
    action: "Farklı öğünlerde alın. Demir kahvaltıyla + C vitamini; çinko akşam yemeğiyle.",
  },
  "zinc-copper": {
    substanceA: "Çinko",
    substanceB: "Bakır (tükenme)",
    mechanism: "Çinko, bakırı bağlayan metallothionein'i indükleyerek zamanla bakır eksikliğine yol açar.",
    action: "Her 15 mg çinko için 2 mg bakır ekleyin. Ya da çinko + bakır kombine ürün kullanın.",
  },
  "antihistamines-melatonin": {
    substanceA: "Melatonin",
    substanceB: "Antihistaminikler (setirizin, loratadin)",
    mechanism: "Birikimli MSS depresyonu ve uyku hali.",
    action: "Melatonin dozunu azaltın veya kombinasyondan kaçının. Maksimum 0,5 mg ile başlayın.",
  },
  "antihistamines-ltheanine": {
    substanceA: "L-Teanin",
    substanceB: "Antihistaminikler",
    mechanism: "Hafif birikimli sedasyon.",
    action: "Aşırı uyku halini izleyin.",
  },
  "corticosteroids-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "Kortikosteroidler (prednizon)",
    mechanism: "Kortikosteroidler D Vitamini'ni tüketir. Takviye, ilaca bağlı eksikliği giderir.",
    action: "TAKVİYE ÖNERİLİR. Seviyeleri takip edin.",
  },
  "corticosteroids-zinc": {
    substanceA: "Çinko",
    substanceB: "Kortikosteroidler",
    mechanism: "Kortikosteroidler zamanla çinko atılımını artırır.",
    action: "Takviye önerilir.",
  },
  "corticosteroids-magnesium": {
    substanceA: "Magnezyum",
    substanceB: "Kortikosteroidler",
    mechanism: "Kortikosteroidler magnezyum atılımını artırır.",
    action: "Takviye önerilir.",
  },
  "osteoporosis-iron": {
    substanceA: "Demir",
    substanceB: "Osteoporoz İlaçları (bifosfonatlar)",
    mechanism: "Demir, bifosfonat emilimini önemli ölçüde azaltır.",
    action: "En az 2 saat ara verin. Bifosfonatı sabah aç karnına alın.",
  },
  "osteoporosis-magnesium": {
    substanceA: "Magnezyum",
    substanceB: "Osteoporoz İlaçları (bifosfonatlar)",
    mechanism: "Magnezyum bifosfonatları şelatlayarak ilaç emilimini azaltır.",
    action: "En az 2 saat ara verin. Bifosfonatı sabah aç karnına alın.",
  },
  "osteoporosis-vitamink2": {
    substanceA: "K2 Vitamini",
    substanceB: "Osteoporoz İlaçları (bifosfonatlar)",
    mechanism: "Kalsiyum ve K2 ile eş zamanlı alım bifosfonat emilimini azaltabilir.",
    action: "Bifosfonatı sabah aç karnına alın. K2 ve kalsiyumu farklı bir öğünde alın.",
  },
  "sleep-aids-melatonin": {
    substanceA: "Melatonin",
    substanceB: "Uyku İlaçları (zolpidem, benzodiazepinler)",
    mechanism: "Birikimli MSS depresyonu — her ikisi de örtüşen yollarla sedasyon yapar.",
    action: "Doktor gözetimi olmadan KESİNLİKLE birleştirmeyin. Aşırı sedasyon riski.",
  },
  "sleep-aids-ashwagandha": {
    substanceA: "Ashwagandha",
    substanceB: "Uyku İlaçları (benzodiazepinler)",
    mechanism: "GABAerjik yollar aracılığıyla birikimli sedasyon.",
    action: "Kombinasyondan kaçının veya ashwagandha dozunu önemli ölçüde azaltın. Aşırı uyku halini izleyin.",
  },
  "sleep-aids-ltheanine": {
    substanceA: "L-Teanin",
    substanceB: "Uyku İlaçları",
    mechanism: "Birikimli sakinleştirici etki — aşırı uyku haline yol açabilir.",
    action: "Aşırı uyku halini izleyin. Gerekirse dozu azaltın.",
  },
  "antibiotics-probiotics": {
    substanceA: "Probiyotikler",
    substanceB: "Antibiyotikler (devam eden kür)",
    mechanism: "Antibiyotikler probiyotik bakterileri öldürür; eş zamanlı alımda etkinlik azalır.",
    action: "Probiyotikleri antibiyotik dozundan 2–3 saat SONRA alın. Kür bittikten 2 hafta daha devam edin.",
  },
  "antibiotics-zinc": {
    substanceA: "Çinko",
    substanceB: "Antibiyotikler (florokinolonlar, tetrasiklin)",
    mechanism: "Çinko, florokinolon ve tetrasiklin antibiyotiklerin emilimini azaltır.",
    action: "En az 2 saat ara verin.",
  },
  "antibiotics-iron": {
    substanceA: "Demir",
    substanceB: "Antibiyotikler",
    mechanism: "Demir, antibiyotik emilimini azaltır.",
    action: "En az 2 saat ara verin.",
  },
  "antibiotics-magnesium": {
    substanceA: "Magnezyum",
    substanceB: "Antibiyotikler (florokinolonlar)",
    mechanism: "Magnezyum florokinolonları şelatlayarak antibiyotik emilimini azaltır.",
    action: "En az 2 saat ara verin.",
  },
  "antifungals-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "Antifungaller (azoller)",
    mechanism: "Bazı azol antifungaller, CYP enzim inhibisyonu yoluyla D Vitamini metabolizmasını etkileyebilir.",
    action: "D Vitamini seviyelerini izleyin. Takviye hâlâ uygun olabilir.",
  },
  "immunosuppressants-curcumin": {
    substanceA: "Kurkumin",
    substanceB: "İmmünosupresanlar",
    mechanism: "Kurkumin bağışıklık fonksiyonunu düzenler ve immünosupresyona müdahale edebilir.",
    action: "KESİNLİKLE KAÇININ. İmmünosupresanlar kullanırken kurkumin kullanmayın.",
  },
  "immunosuppressants-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "İmmünosupresanlar",
    mechanism: "D Vitamini bağışıklık yanıtını düzenler — immünosupresyon etkinliğini etkileyebilir.",
    action: "Yalnızca doktor gözetiminde kullanın.",
  },
  "immunosuppressants-omega3": {
    substanceA: "Omega-3 (Balık Yağı)",
    substanceB: "İmmünosupresanlar",
    mechanism: "Yüksek dozlarda hafif bağışıklık modulasyonu.",
    action: "Standart dozlarda (1–2 g EPA+DHA) genellikle güvenlidir. Doktorunuzla görüşün.",
  },
  "seizure-meds-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "Epilepsi İlaçları (antikonvülzanlar)",
    mechanism: "Antikonvülzanlar, CYP enzim indüksiyonu yoluyla D Vitamini'ni tüketir. Takviye eksikliği giderir.",
    action: "TAKVİYE ÖNERİLİR. Seviyeleri takip edin.",
  },
  "seizure-meds-vitaminb12": {
    substanceA: "B12 Vitamini",
    substanceB: "Epilepsi İlaçları (antikonvülzanlar)",
    mechanism: "Bazı antikonvülzanlar B12 dahil B vitaminlerini tüketir.",
    action: "Takviye önerilir.",
  },
  "seizure-meds-omega3": {
    substanceA: "Omega-3 (Balık Yağı)",
    substanceB: "Epilepsi İlaçları",
    mechanism: "Nadir vakalarda yüksek doz balık yağı nöbet eşiğini düşürebilir.",
    action: "Yalnızca standart doz kullanın (≤2 g EPA+DHA). Yüksek doz takviyeden kaçının.",
  },
  "hrt-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "Hormon Replasman Tedavisi (HRT)",
    mechanism: "HRT kalsiyum metabolizmasını etkiler. D Vitamini, HRT ile birlikte kemik sağlığını destekler.",
    action: "Kemik sağlığı için TAKVİYE ÖNERİLİR.",
  },
  "hrt-magnesium": {
    substanceA: "Magnezyum",
    substanceB: "Hormon Replasman Tedavisi (HRT)",
    mechanism: "Magnezyum, HRT ile birlikte hormon dengesini ve kemik sağlığını destekler.",
    action: "Takviye önerilir.",
  },
  "anti-asthmatic-magnesium": {
    substanceA: "Magnezyum",
    substanceB: "Astım İlaçları (inhalerler, montelukast)",
    mechanism: "Magnezyum, astım tedavisini tamamlayabilecek hafif bronkodilatör özelliklere sahiptir.",
    action: "Genellikle güvenlidir. Tedaviyi tamamlayabilir.",
  },
  "anti-neoplastic-nac": {
    substanceA: "NAC (N-Asetil Sistein)",
    substanceB: "Antikanser İlaçları (kemoterapi)",
    mechanism: "Antioksidanlar, kemoterapinin kanser hücrelerine yönelik oksidatif mekanizmasını azaltabilir.",
    action: "Onkolog onayı olmadan aktif kemoterapi süresince TÜM antioksidan takviyeleri KULLANMAYIN.",
  },
  "anti-neoplastic-vitaminc": {
    substanceA: "C Vitamini",
    substanceB: "Antikanser İlaçları (kemoterapi)",
    mechanism: "Yüksek doz C Vitamini (antioksidan) kemoterapi mekanizmalarına müdahale edebilir.",
    action: "Onkolog onayı olmadan aktif kemoterapi süresince KULLANMAYIN.",
  },
  "anti-neoplastic-coq10": {
    substanceA: "CoQ10",
    substanceB: "Antikanser İlaçları (kemoterapi)",
    mechanism: "CoQ10 (antioksidan) kemoterapi mekanizmalarına müdahale edebilir.",
    action: "Onkolog onayı olmadan aktif kemoterapi süresince KULLANMAYIN.",
  },
  "anti-neoplastic-curcumin": {
    substanceA: "Kurkumin",
    substanceB: "Antikanser İlaçları (kemoterapi)",
    mechanism: "Kurkumin kemoterapiye müdahale edebilir. Aktif tedavi süresince risk faydadan fazladır.",
    action: "Onkolog onayı olmadan aktif kemoterapi süresince KULLANMAYIN.",
  },
  "anti-neoplastic-vitamind3": {
    substanceA: "D3 Vitamini",
    substanceB: "Antikanser İlaçları (kemoterapi)",
    mechanism: "Bazı kanıtlar fayda gösterse de araştırmalar çelişkilidir. Onkolog gözetimi gereklidir.",
    action: "Aktif tedavi süresince takviye kullanmadan önce onkologunuzla görüşün.",
  },
};

// Check interactions for a given supplement against user's medications
export function checkDrugInteractions(
  supplementId: string,
  medicationIds: string[]
): Interaction[] {
  return interactions.filter(
    (i) =>
      i.substanceAId === supplementId &&
      i.substanceBType === "drug" &&
      i.medicationId &&
      medicationIds.includes(i.medicationId)
  );
}

// Check supplement-supplement interactions within a stack
export function checkStackInteractions(
  supplementIds: string[]
): Interaction[] {
  return interactions.filter(
    (i) =>
      i.substanceBType === "supplement" &&
      supplementIds.includes(i.substanceAId)
  );
}
