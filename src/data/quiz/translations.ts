export type Lang = "tr" | "en" | "ar" | "ru" | "el" | "fr" | "es" | "de" | "fa";

// ── Question translations ─────────────────────────────────────────────────
export interface QuestionTranslation {
  section: string;
  question: string;
  subtitle?: string;
  options: Record<string, { label: string; description?: string; group?: string }>;
}

// ── UI translations ───────────────────────────────────────────────────────
export interface QuizUIStrings {
  awaiting: {
    title: string;
    subtitle: (pharmacyName: string) => string;
    timerLabel: string;
    infoText: string;
    cancelBtn: string;
  };
  landing: {
    badge: string;
    titleLine1: string;
    titleLine2: string;
    subtitle: string;
    cta: string;
    minutes: string;
    questions: string;
    free: string;
    trustPharmacist: string;
    trustInteraction: string;
    trustEvidence: string;
    whatYouGetTitle: string;
    feature1Title: string;
    feature1Desc: string;
    feature2Title: string;
    feature2Desc: string;
    feature3Title: string;
    feature3Desc: string;
    readyCTA: string;
    startCTA: string;
  };
  quiz: {
    back: string;
    continue: string;
    skip: string;
    selectAll: string;
    of: string;
    other: string;
    otherPlaceholder: string;
  };
  results: {
    badge: string;
    title: string;
    recommendedTitle: string;
    interactionTitle: string;
    scheduleTitle: string;
    scheduleNote: string;
    notesTitle: string;
    retake: string;
    share: string;
    shareText: string;
    linkCopied: string;
    downloadPdf: string;
    priority: Record<"essential" | "recommended" | "optional", string>;
    bestForm: string;
    dose: string;
    timing: string;
    withFood: string;
    withFoodYes: string;
    withFoodNo: string;
    withFoodOptional: string;
    pharmacistTip: string;
    viewProduct: string;
    evidenceLabel: string;
    perMonth: string;
    back: string;
    backToApp: string;
  };
  loading: {
    title: string;
    subtitle: string;
    steps: { emoji: string; text: string }[];
  };
}

// ── Engine translations ───────────────────────────────────────────────────
export interface QuizEngineStrings {
  goalLabels: Record<string, string>;
  coreReason: (goalLabel: string) => string;
  supportsReason: (goalLabel: string) => string;
  additionalReason: (goalLabel: string) => string;
  secondaryKeyReason: (goalLabel: string) => string;
  secondarySupportsReason: (goalLabel: string) => string;
  reasons: {
    veganB12: string;
    veganIron: string;
    veganOmega3: string;
    vegetarianB12: string;
    ketoElectrolytes: string;
    ketoMagnesium: string;
    minimalSunD3: string;
    highStressAshwagandha: string;
    highStressMagnesium: string;
    poorSleepMagnesium: string;
    poorSleepTheanine: string;
    heavyCreatine: string;
    heavyElectrolytes: string;
    femalePre: string;
    femalePostD3: string;
    femalePostK2: string;
    statinsCoq10: string;
    metforminB12: string;
    coq10AgeSuffix: string;
    algaeAllergySuffix: string;
    sym: {
      fatigue: string;
      afternoonCrash: string;
      unrefreshedSleep: string;
      brainFog: string;
      anxiety: string;
      lowMood: string;
      irritability: string;
      stressOverwhelm: string;
      sleepOnset: string;
      sleepQuality: string;
      brittleNails: string;
      hairLoss: string;
      drySkin: string;
      slowHealing: string;
      graying: string;
      cramps: string;
      jointPain: string;
      weakness: string;
      slowRecovery: string;
      frequentIllness: string;
      allergies: string;
      bloating: string;
      indigestion: string;
      constipation: string;
      foodSens: string;
      boneDensity: string;
      agingDecline: string;
      restrictiveDiet: string;
      pregnancy: string;
      postSurgery: string;
      poorNutrition: string;
      muscleBuilding: string;
      weightGoal: string;
      gymPerformance: string;
      attention: string;
      poorAppetite: string;
      sugarCravings: string;
      poorSatiety: string;
    };
  };
  doseAdjustments: {
    vitaminD3LowSun: string;
    b12Vegan: string;
    magnesiumHeavy: string;
    electrolytesKeto: string;
  };
  timingSlots: {
    morning: string;
    midMorning: string;
    lunch: string;
    evening: string;
    anytime: string;
  };
  timingNotes: {
    iron: string;
    fiber: string;
    takeWithFood: string;
  };
  summary: (
    count: number,
    primary: string,
    secondary: string | null,
    essentialCount: number,
    totalWarnings: number
  ) => string;
  disclaimers: {
    base: [string, string];
    removedSupplements: (count: number, names: string) => string;
    bloodThinners: string;
  };
}

// ── Supplement translations ───────────────────────────────────────────────
export interface SupplementTranslation {
  primaryBenefit: string;
  pharmacistNote: string;
  category: string;
  bestForm?: string;
  standardDose?: string;
  timing?: string;
}

// ── Full translation bundle ───────────────────────────────────────────────
export interface QuizTranslations {
  ui: QuizUIStrings;
  engine: QuizEngineStrings;
  questions: Record<string, QuestionTranslation>;
  supplements: Record<string, SupplementTranslation>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TURKISH
// ─────────────────────────────────────────────────────────────────────────────
const tr: QuizTranslations = {
  ui: {
    awaiting: {
      title: 'İnceleme Bekleniyor',
      subtitle: (name) => `${name} takviye sonuçlarınızı inceliyor.`,
      timerLabel: 'İNCELEME KAPANIYOR',
      infoText: 'Lisanslı bir eczacı yanıtlarınızı kontrol ediyor ve nihai sonuçları görmeden önce takviye planınızı düzenleyebilir.',
      cancelBtn: 'Farklı bir eczacı seç',
    },
    landing: {
      badge: "Eczacı Tasarımı Quiz",
      titleLine1: "Gerçekten Hangi Takviyelere",
      titleLine2: "İhtiyacın Var?",
      subtitle:
        "Tahmin etmeyi bırak! Lisanslı bir eczacı tarafından tasarlanan bu test, belirsizliği ortadan kaldırır — sağlık hedeflerine, ilaçlarına ve yaşam tarzına göre kişiselleştirilmiş takviye programı oluşturmana yardımcı olur.",
      cta: "Hızlı Teste Katıl →",
      minutes: "3 dakika",
      questions: "16 soru",
      free: "Tamamen ücretsiz",
      trustPharmacist: "Lisanslı eczacı tarafından hazırlandı",
      trustInteraction: "İlaç etkileşimi taraması",
      trustEvidence: "Kanıta dayalı öneriler",
      whatYouGetTitle: "Ne Kazanacaksın",
      feature1Title: "Kişisel Program",
      feature1Desc:
        "Yaşına, hedeflerine, diyetine ve yaşam tarzına göre seçilmiş takviyeler — genel tavsiye değil.",
      feature2Title: "Güvenlik Taraması",
      feature2Desc:
        "Programın tehlikeli etkileşimler için ilaçlarınla çapraz kontrol edilir. ",
      feature3Title: "Zamanlama Programı",
      feature3Desc:
        "Her takviyeyi tam olarak ne zaman alacağın ve nedeni — çünkü zamanlama emilimi %75'e kadar etkiler.",
      readyCTA: "Gerçekten neye ihtiyacın olduğunu öğrenmeye hazır mısın?",
      startCTA: "Test'i Başlat →",
    },
    quiz: {
      back: "← Geri",
      continue: "Devam →",
      skip: "Atla →",
      selectAll: "Geçerli olanların tümünü seç",
      of: "/",
      other: "Diğer",
      otherPlaceholder: "Yazın ve Enter'a basın...",
    },
    results: {
      badge: "Kişisel Sonuçların",
      title: "Takviye Programın",
      recommendedTitle: "Önerilen Takviyeler",
      interactionTitle: "Etkileşim Uyarıları",
      scheduleTitle: "Günlük Zamanlama Programın",
      scheduleNote:
        "Zamanlama emilimi %75'e kadar etkiler. Maksimum etkinlik için bu programa uy.",
      notesTitle: "Önemli Notlar",
      retake: "← Quiz'i Tekrarla",
      share: "Sonuçlarını Paylaş 📤",
      shareText:
        "Eczacı tasarımı bir quizden kişiselleştirilmiş takviye programımı aldım!",
      linkCopied: "Bağlantı panoya kopyalandı!",
      downloadPdf: "PDF İndir ↓",
      priority: {
        essential: "Temel",
        recommended: "Önerilen",
        optional: "İsteğe Bağlı",
      },
      bestForm: "En İyi Form",
      dose: "Doz",
      timing: "Zamanlama",
      withFood: "Yemekle",
      withFoodYes: "Evet ✓",
      withFoodNo: "Hayır — aç karnına",
      withFoodOptional: "İsteğe bağlı",
      pharmacistTip: "💡 Eczacı İpucu:",
      viewProduct: "Bu Ürünü Satın Al →",
      evidenceLabel: "Kanıt",
      perMonth: "/ay",
      back: "← Geri",
      backToApp: "← Uygulamaya Dön",
    },
    loading: {
      title: "Programın Hazırlanıyor",
      subtitle: "Eczacın yanıtlarını inceliyor...",
      steps: [
        { emoji: "🔍", text: "Profilin analiz ediliyor..." },
        { emoji: "💊", text: "Hedeflerine göre takviyeler eşleştiriliyor..." },
        { emoji: "⚠️", text: "İlaç etkileşimleri taranıyor..." },
        { emoji: "⏰", text: "Zamanlama programın oluşturuluyor..." },
        { emoji: "✅", text: "Programın tamamlanıyor..." },
      ],
    },
  },

  engine: {
    goalLabels: {
      energy: "Enerji & Vitalite",
      sleep: "Daha İyi Uyku",
      immunity: "Bağışıklık Desteği",
      joints: "Eklem Sağlığı",
      stress: "Stres & Kaygı Giderme",
      cognitive: "Beyin & Odaklanma",
      athletic: "Atletik Performans",
      gut: "Bağırsak Sağlığı",
      heart: "Kalp Sağlığı",
      skin: "Cilt, Saç & Tırnaklar",
      weight: "Kilo Yönetimi",
      longevity: "Uzun Ömür & Anti-Aging",
    },
    coreReason: (g) => `${g} için temel takviye`,
    supportsReason: (g) => `${g} desteği sağlar`,
    additionalReason: (g) => `${g} için ek destek`,
    secondaryKeyReason: (g) => `İkincil hedef için temel: ${g}`,
    secondarySupportsReason: (g) => `İkincil hedef desteği: ${g}`,
    reasons: {
      veganB12: "Veganlar için kritik — bitki gıdaları B12 içermez",
      veganIron: "Veganlar demir eksikliği açısından daha yüksek riske sahiptir",
      veganOmega3:
        "Alg bazlı kullan — vegan diyetlerinde eksik olan temel yağ asitleri",
      vegetarianB12:
        "Vejetaryenler genellikle yetersiz B12 seviyesine sahiptir",
      ketoElectrolytes:
        "Keto elektrolitleri hızla tüketir — 'keto gribi' genellikle elektrolit eksikliğidir",
      ketoMagnesium: "Keto, magnezyum kaybını artırır",
      minimalSunD3:
        "Çoğunlukla iç mekânda = neredeyse kesinlikle D Vitamini eksikliği. En yüksek etkili tek takviye.",
      highStressAshwagandha:
        "Yüksek stres, magnezyum ve B vitaminlerini daha hızlı tüketir",
      highStressMagnesium: "Stres, magnezyum tükenme hızını artırır",
      poorSleepMagnesium:
        "Kötü uyku — magnezyum glisinat, rahatlama için GABA'yı aktive eder",
      poorSleepTheanine:
        "Daha kolay uykuya dalış için alfa beyin dalgalarını destekler",
      heavyCreatine:
        "Yoğun antrenman — kreatin güç çıktısını ve toparlanmayı destekler",
      heavyElectrolytes: "Yoğun terleme, mineralleri önemli ölçüde tüketir",
      femalePre:
        "Premenopozal kadınların adet nedeniyle daha yüksek demir ihtiyacı vardır",
      femalePostD3: "Menopoz sonrası kemik yoğunluğu koruması",
      femalePostK2: "Kalsiyumu kemiklere yönlendirir (menopoz sonrası kritik)",
      statinsCoq10:
        "Statinler CoQ10'u tüketir — statin kaynaklı kas ağrısının 1 numaralı nedeni. Bu, statininin zorunlu tamamlayıcısıdır.",
      metforminB12:
        "Metforminin zamanla B12'yi tükettiği kanıtlanmıştır. Seviyelerini yıllık olarak kontrol ettir.",
      coq10AgeSuffix:
        " 40 yaş üstü için Ubiquinol formunu kullan — dönüşüm kapasitesi 40'tan sonra azalır.",
      algaeAllergySuffix: " (Alg bazlı kullan — alerjin nedeniyle balık yağı değil)",
      sym: {
        fatigue: "Kronik yorgunluk ve bitkinliğini doğrudan hedefler",
        afternoonCrash: "Öğleden sonra enerji çöküntüsünü önlemek için sürekli enerji desteği",
        unrefreshedSleep: "Uyku derinliğini ve dinlenerek uyanmayı destekler",
        brainFog: "Beyin sisi, konsantrasyon ve bellek sorunlarını doğrudan hedefler",
        anxiety: "Kaygı ve stres tepkisi için klinik olarak desteklenmiş",
        lowMood: "Ruh hali için nörotransmiter dengesini destekler",
        irritability: "Sinirlilik; magnezyum ve B vitaminleri duygusal stresle tükenir",
        stressOverwhelm: "Stres direnci için adaptojenik destek",
        sleepOnset: "GABA'yı ve uykuya dalışı destekler",
        sleepQuality: "Uyku sürekliliğini ve derin uykuyu destekler",
        brittleNails: "Çinko ve kolajen, tırnaklar için temel yapısal besinlerdir",
        hairLoss: "Saç dökülmesinin yaygın nedenleri olan çinko, kolajen ve demiri hedefler",
        drySkin: "Omega-3 ve kolajen, cilt bariyeri ve nemlenmeyi destekler",
        slowHealing: "C vitamini ve çinko, doku onarımı için esastır",
        graying: "B12 eksikliği erken grileşmeyle ilişkilendirilmiştir",
        cramps: "Magnezyum ve elektrolit eksikliği, kramların en sık nedenidir",
        jointPain: "Omega-3 ve kurkumin, eklem iltihabı ve sertliğini azaltır",
        weakness: "B12 ve demir eksikliği, genel zayıflığın sık nedenleridir",
        slowRecovery: "Egzersiz sonrası toparlanmayı ve kas onarımını destekler",
        frequentIllness: "Temel bağışıklık desteği: D vitamini, çinko ve C vitamini",
        allergies: "Bağışıklık aşırı tepkisini ve mevsimsel alerji şiddetini düzenler",
        bloating: "Probiyotikler ve lif, bağırsak dengesini yeniler ve şişkinliği azaltır",
        indigestion: "Sindirim enzimi dengesi için probiyotik desteği",
        constipation: "Psillyum lifi ve magnezyum bağırsak düzenliliğini destekler",
        foodSens: "Gıda hassasiyeti için bağırsak mikrobiyomu ve bariyer bütünlüğü",
        boneDensity: "Kritik kemik yoğunluğu desteği: D3, K2 ve magnezyum",
        agingDecline: "Yaşlanma karşıtı beyin ve hücresel enerji desteği",
        restrictiveDiet: "Kısıtlayıcı beslenmeden kaynaklanan temel besin eksikliklerini kapatır",
        pregnancy: "Hamilelik sürecinde anne ve bebek sağlığını destekler",
        postSurgery: "Ameliyat sonrası doku iyileşmesini ve toparlanmayı destekler",
        poorNutrition: "Çeşitli bir diyetteki yaygın eksiklikleri giderir",
        muscleBuilding: "Kreatin, kas kazanımı için en kanıta dayalı takviyedir",
        weightGoal: "Kilo yönetimi için tokluk ve kan şekerini destekler",
        gymPerformance: "Spor performansı, dayanıklılık ve toparlanmayı destekler",
        attention: "Omega-3 ve L-teanin dikkat ve odaklanmayı artırır",
        poorAppetite: "Çinko eksikliği, iştah azlığının sık ve geri döndürülebilir bir nedenidir",
        sugarCravings: "Berberin ve lif kan şekerini düzenler ve şeker krizlerini azaltır",
        poorSatiety: "Lif ve berberin tokluk sinyalini iyileştirir",
      },
    },
    doseAdjustments: {
      vitaminD3LowSun:
        "Günde 4.000 IU ile başla (az güneş maruziyeti nedeniyle daha yüksek doz)",
      b12Vegan: "Günde 2.500 mcg (tek kaynak olduğu için daha yüksek doz)",
      magnesiumHeavy: "Günde 400–500 mg (yoğun antrenman nedeniyle artırılmış)",
      electrolytesKeto: "Keto adaptasyonu süresince günde 2–3 porsiyon",
    },
    timingSlots: {
      morning: "Sabah (kahvaltıyla)",
      midMorning: "Öğle Öncesi",
      lunch: "Öğle Yemeği",
      evening: "Akşam (yatmadan önce)",
      anytime: "İstediğin Zaman (tutarlılık önemli)",
    },
    timingNotes: {
      iron: "C vitaminiyle al, kahveden uzak tut",
      fiber: "Büyük bir bardak suyla",
      takeWithFood: "Yemekle al",
    },
    summary: (count, primary, secondary, essentialCount, totalWarnings) =>
      `Profiline göre, ${primary}${secondary ? ` ve ${secondary}` : ""} hedefleyen ${count} takviyeli bir program hazırladım. ${essentialCount} takviye durumun için temel niteliktedir${
        totalWarnings > 0 ? `; ${totalWarnings} etkileşim uyarısı işaretledim` : ""
      }.`,
    disclaimers: {
      base: [
        "Bu quiz, eğitim amaçlı rehberlik sunar ve profesyonel tıbbi tavsiyenin yerini tutmaz.",
        "Herhangi bir takviye rejimine başlamadan önce sağlık uzmanına danış.",
      ],
      removedSupplements: (count, names) =>
        `${count} takviye, ilaçlarınla olan etkileşimler nedeniyle hariç tutuldu: ${names}.`,
      bloodThinners:
        "Kan sulandırıcı kullanıyorsun. Her yeni takviye, eczacın veya doktoran tarafından onaylanmalıdır.",
    },
  },

  questions: {
    age: {
      section: "Hakkında",
      question: "Yaş aralığın nedir?",
      options: {
        "20-30": { label: "20–30" },
        "30-40": { label: "30–40" },
        "40-50": { label: "40–50" },
        "50-60": { label: "50–60" },
      },
    },
    sex: {
      section: "Hakkında",
      question: "Biyolojik cinsiyetin nedir?",
      subtitle: "Bu, besin gereksinimleri ve doz önerilerini etkiler.",
      options: {
        male: { label: "Erkek" },
        female: { label: "Kadın" },
      },
    },
    menopause: {
      section: "Hakkında",
      question: "Menopozda mısın?",
      options: {
        post: { label: "Evet (menopozda)" },
        pre: { label: "Hayır (menopozda değilim)" },
        unsure: { label: "Menopoza geçiş sürecindeyim (Peri-menopoz)" },
      },
    },
    medications: {
      section: "Hakkında",
      question: "Şu anda herhangi bir ilaç kullanıyor musun?",
      subtitle:
        "Bu, takviye-ilaç etkileşimlerini kontrol etmek için kritiktir. Geçerli olanların tümünü seç.",
      options: {
        statins: { label: "Statinler (kolesterol)" },
        metformin: { label: "Metformin (diyabet)" },
        "blood-thinners": { label: "Kan sulandırıcılar (warfarin vb.)" },
        thyroid: { label: "Tiroid ilacı" },
        ssri: { label: "Antidepresanlar (SSRI)" },
        ppi: { label: "Mide asidi / PPI" },
        "bp-meds": { label: "Tansiyon ilacı" },
        "birth-control": { label: "Doğum kontrolü" },
        antihistamines: { label: "Antihistaminikler (setirizin, loratadin)" },
        corticosteroids: { label: "Kortikosteroidler (prednizon)" },
        "osteoporosis-meds": { label: "Osteoporoz ilaçları (bifosfonatlar)" },
        "sleep-aids": { label: "Uyku ilaçları (zolpidem, benzodiazepinler)" },
        antibiotics: { label: "Antibiyotikler (devam eden kür)" },
        antifungals: { label: "Antifungaller" },
        immunosuppressants: { label: "İmmünosupresanlar" },
        "seizure-meds": { label: "Epilepsi ilaçları (antikonvülzanlar)" },
        hrt: { label: "Hormon replasman tedavisi (HRT)" },
        "anti-asthmatic": { label: "Astım ilaçları (inhalerler, montelukast)" },
        "anti-neoplastic": { label: "Antikanser ilaçları (kemoterapi)" },
        none: { label: "Hiçbiri" },
      },
    },
    diet: {
      section: "Yaşam Tarzın",
      question: "Beslenme düzenini nasıl tanımlarsın?",
      options: {
        omnivore: { label: "Omnivor", description: "Her şeyi yerim" },
        vegetarian: {
          label: "Vejetaryen",
          description: "Et yok, ama yumurta/süt var",
        },
        vegan: { label: "Vegan", description: "Tamamen bitkisel" },
        keto: {
          label: "Keto / Düşük Karbonhidrat",
          description: "Yüksek yağ, düşük karbonhidrat",
        },
        mediterranean: {
          label: "Akdeniz",
          description: "Tam gıda, zeytinyağı, balık",
        },
        "no-specific": {
          label: "Belirli bir diyet yok",
          description: "Ne bulursam yerim",
        },
      },
    },
    exercise: {
      section: "Yaşam Tarzın",
      question: "Ne sıklıkla egzersiz yaparsın?",
      options: {
        rarely: { label: "Nadiren", description: "Haftada birden az" },
        light: { label: "Haftada 1–2x", description: "Hafif aktivite" },
        moderate: { label: "Haftada 3–4x", description: "Düzenli antrenman" },
        heavy: { label: "Haftada 5+ gün", description: "Ciddi antrenman" },
      },
    },
    stress: {
      section: "Yaşam Tarzın",
      question: "Stres seviyeni nasıl değerlendirirsin?",
      options: {
        low: { label: "Düşük (1–3)", description: "Genellikle rahat" },
        moderate: { label: "Orta (4–6)", description: "Normal günlük stres" },
        high: {
          label: "Yüksek (7–10)",
          description: "Sık sık bunalmış hissediyorum",
        },
      },
    },
    sleep: {
      section: "Yaşam Tarzın",
      question: "Uyku kaliten nasıl?",
      options: {
        great: { label: "Harika", description: "Kolayca uykuya dalıyorum" },
        okay: { label: "İdare eder", description: "Ara sıra sorunlar" },
        poor: {
          label: "Kötü",
          description: "Uyumakta ya da uyanık kalmakta sürekli sorun",
        },
      },
    },
    sun: {
      section: "Yaşam Tarzın",
      question: "Günde ne kadar güneş ışığı alıyorsun?",
      options: {
        lots: {
          label: "Çok",
          description: "Açık hava işi veya yaşam tarzı",
        },
        some: { label: "Biraz", description: "Günde 30+ dakika" },
        minimal: { label: "Az", description: "Çoğunlukla iç mekânda" },
      },
    },
    "primary-goal": {
      section: "Hedeflerin",
      question: "Birincil sağlık hedefin nedir?",
      subtitle: "Şu an için en önemli olanı seç.",
      options: {
        energy: { label: "Enerji & Vitalite" },
        sleep: { label: "Daha İyi Uyku" },
        immunity: { label: "Bağışıklık Desteği" },
        joints: { label: "Eklem Sağlığı & Hareketlilik" },
        stress: { label: "Stres & Kaygı" },
        cognitive: { label: "Beyin & Odaklanma" },
        athletic: { label: "Atletik Performans" },
        gut: { label: "Bağırsak Sağlığı & Sindirim" },
        heart: { label: "Kalp Sağlığı" },
        skin: { label: "Cilt, Saç & Tırnaklar" },
        weight: { label: "Kilo Yönetimi" },
        longevity: { label: "Uzun Ömür & Anti-Aging" },
      },
    },
    "secondary-goal": {
      section: "Hedeflerin",
      question: "İkincil bir sağlık hedefin var mı?",
      options: {
        energy: { label: "Enerji & Vitalite" },
        sleep: { label: "Daha İyi Uyku" },
        immunity: { label: "Bağışıklık Desteği" },
        joints: { label: "Eklem Sağlığı" },
        stress: { label: "Stres & Kaygı" },
        cognitive: { label: "Beyin & Odaklanma" },
        athletic: { label: "Atletik Performans" },
        gut: { label: "Bağırsak Sağlığı" },
        heart: { label: "Kalp Sağlığı" },
        skin: { label: "Cilt, Saç & Tırnaklar" },
        weight: { label: "Kilo Yönetimi" },
        longevity: { label: "Uzun Ömür" },
        none: { label: "İkincil hedef yok" },
      },
    },
    complaints: {
      section: "Şikayetleriniz",
      question: "Şu anda hangi şikayetleriniz var?",
      subtitle: "Geçerli olanların tümünü seç — bu bilgi takviyeleri gerçek semptomlarına göre özelleştirmemizi sağlar.",
      options: {
        "chronic-fatigue": { label: "Kronik Yorgunluk / Sürekli Bitkinlik", group: "Enerji & Yorgunluk" },
        "afternoon-crash": { label: "Öğleden Sonra Enerji Çöküntüsü", group: "Enerji & Yorgunluk" },
        "unrefreshed-sleep": { label: "Dinlenmemiş Uyanma", group: "Enerji & Yorgunluk" },
        "brain-fog": { label: "Beyin Sisi, Konsantrasyon Güçlüğü, Unutkanlık", group: "Enerji & Yorgunluk" },
        "anxiety": { label: "Kaygı / Endişe", group: "Ruh Hali, Stres & Uyku" },
        "low-mood": { label: "Düşük Ruh Hali / Mutsuzluk", group: "Ruh Hali, Stres & Uyku" },
        "irritability": { label: "Sinirlilik / Ruh Hali Dalgalanması", group: "Ruh Hali, Stres & Uyku" },
        "stress-overwhelm": { label: "Stresle Başa Çıkma Zorluğu", group: "Ruh Hali, Stres & Uyku" },
        "trouble-falling-asleep": { label: "Uykuya Dalmakta Güçlük", group: "Ruh Hali, Stres & Uyku" },
        "waking-at-night": { label: "Gece Uyanma / Huzursuz Uyku", group: "Ruh Hali, Stres & Uyku" },
        "brittle-nails": { label: "Kırılgan / Zayıf Tırnaklar", group: "Saç, Cilt & Tırnaklar" },
        "hair-loss": { label: "Saç Dökülmesi / İncelmesi", group: "Saç, Cilt & Tırnaklar" },
        "dry-skin": { label: "Kuru veya Pullu Cilt", group: "Saç, Cilt & Tırnaklar" },
        "slow-healing": { label: "Yavaş Yara İyileşmesi", group: "Saç, Cilt & Tırnaklar" },
        "premature-graying": { label: "Erken Grileşme", group: "Saç, Cilt & Tırnaklar" },
        "muscle-cramps": { label: "Kas Krampları / Seğirme", group: "Kas, Eklem & Toparlanma" },
        "joint-stiffness": { label: "Eklem Sertliği veya Ağrısı", group: "Kas, Eklem & Toparlanma" },
        "general-weakness": { label: "Genel Kas Zayıflığı", group: "Kas, Eklem & Toparlanma" },
        "slow-recovery": { label: "Egzersiz Sonrası Yavaş Toparlanma", group: "Kas, Eklem & Toparlanma" },
        "frequent-illness": { label: "Sık Hastalanma / Enfeksiyonlar", group: "Bağışıklık" },
        "seasonal-allergies": { label: "Mevsimsel Alerjilerin Kötüleşmesi", group: "Bağışıklık" },
        "bloating-gas": { label: "Şişkinlik / Gaz", group: "Sindirim & Bağırsak" },
        "indigestion": { label: "Hazımsızlık / Mide Yanması", group: "Sindirim & Bağırsak" },
        "constipation": { label: "Kabızlık", group: "Sindirim & Bağırsak" },
        "food-sensitivities": { label: "Gıda Hassasiyeti / Yemek Sonrası Rahatsızlık", group: "Sindirim & Bağırsak" },
        "bone-density-concern": { label: "Kemik Yoğunluğu / Osteoporoz Endişesi", group: "Kemik Sağlığı & Yaşlanma" },
        "age-related-decline": { label: "Yaşa Bağlı Bellek, Enerji veya Görme Sorunları", group: "Kemik Sağlığı & Yaşlanma" },
        "restrictive-diet": { label: "Vegan veya Çok Kısıtlayıcı Diyet", group: "Beslenme Eksiklikleri & Yaşam Dönemleri" },
        "pregnancy-planning": { label: "Hamilelik veya Hamile Kalmaya Çalışma", group: "Beslenme Eksiklikleri & Yaşam Dönemleri" },
        "post-surgery": { label: "Ameliyat veya Yaralanma Sonrası İyileşme", group: "Beslenme Eksiklikleri & Yaşam Dönemleri" },
        "poor-nutrition": { label: "Yetersiz Çeşitlilik veya Öğün Atlama", group: "Beslenme Eksiklikleri & Yaşam Dönemleri" },
        "muscle-building": { label: "Kas Kütlesi Kazanmak", group: "Fitness & Vücut Hedefleri" },
        "weight-management-goal": { label: "Kilo Yönetimi / Yağ Kaybı", group: "Fitness & Vücut Hedefleri" },
        "gym-performance": { label: "Spor Performansı veya Dayanıklılık", group: "Fitness & Vücut Hedefleri" },
        "attention-focus": { label: "Odaklanma Güçlüğü, Kolay Dikkat Dağılması", group: "Dikkat & Odaklanma" },
        "poor-appetite": { label: "İştah Azlığı / Az Yemek Yeme", group: "İştah" },
        "sugar-cravings": { label: "Şeker Krizleri / Aşırı Yeme", group: "İştah" },
        "poor-satiety": { label: "Yemekten Sonra Yetersiz Tokluk Hissi", group: "İştah" },
        none: { label: "Herhangi bir şikayetim yok" },
      },
    },
    allergies: {
      section: "Tercihler",
      question: "Herhangi bir alerji veya hassasiyetin var mı?",
      subtitle:
        "Geçerli olanları seç. Bu, güvensiz ürün önerilerini filtreler.",
      options: {
        shellfish: { label: "Kabuklu deniz ürünleri" },
        soy: { label: "Soya" },
        gluten: { label: "Gluten" },
        fish: { label: "Balık" },
        dairy: { label: "Süt ürünleri" },
        none: { label: "Hiçbiri" },
      },
    },
    form: {
      section: "Tercihler",
      question: "Hangi takviye formunu tercih edersin?",
      options: {
        capsules: { label: "Kapsül / Tablet" },
        gummies: { label: "Şeker Kaplama (Gummy)" },
        powder: { label: "Toz" },
        liquid: { label: "Sıvı" },
        "no-preference": { label: "Fark etmez" },
      },
    },
    currency: {
      section: "Tercihler",
      question: "Hangi para birimini tercih edersin?",
      options: {
        usd: { label: "USD ($)" },
        eur: { label: "EUR (€)" },
        gbp: { label: "GBP (£)" },
        try: { label: "TRY (₺)" },
      },
    },
    budget: {
      section: "Tercihler",
      question: "Aylık takviye bütçen ne kadar?",
      options: {
        starter: {
          label: "Başlangıç",
          description: "$15–25 / €14–23 / £12–20 / ₺510–850",
        },
        budget: {
          label: "Ekonomik",
          description: "$25–50 / €23–46 / £20–40 / ₺850–1.700",
        },
        mid: {
          label: "Orta Segment",
          description: "$50–100 / €46–92 / £40–80 / ₺1.700–3.400",
        },
        premium: {
          label: "Premium",
          description: "$100–150 / €92–138 / £80–120 / ₺3.400–5.100",
        },
        ultra: {
          label: "Ultra",
          description: "$150+ / €138+ / £120+ / ₺5.100+",
        },
      },
    },
    newsletter: {
      section: "Güncel Kal",
      question: "Aylık eczacı onaylı takviye içgörüleri ister misin?",
      subtitle:
        "Ücretsiz bültenimize katıl — yeni araştırmalar, efsane çürütme ve ürün uyarıları.",
      options: {
        yes: { label: "Evet, abone ol!" },
        no: { label: "Hayır teşekkürler, sonuçlarımı göster" },
      },
    },
  },

  supplements: {
    "vitamin-d3": {
      category: "Vitamin",
      primaryBenefit: "Kemik sağlığı & Bağışıklık",
      pharmacistNote:
        "K2 (MK-7) ile birlikte al — kalsiyumun doğru yere gitmesi için. Mümkünse önce kan seviyeni test ettir. Hedef: 40–60 ng/mL.",
      bestForm: "Kolekalsiferol (D3), D2 DEĞİL",
      standardDose: "2.000–4.000 IU/gün",
      timing: "Sabah kahvaltıyla",
    },
    magnesium: {
      category: "Mineral",
      primaryBenefit: "Uyku & Kas gevşemesi",
      pharmacistNote:
        "Oksit formu çok düşük emilime sahip (~%4). Glisinat altın standarttır. Yetişkinlerin büyük çoğunluğu magnezyum eksikliği yaşar.",
      bestForm: "Glisinat (uyku), Treonat (bilişsel), Sitrat (sindirim)",
      standardDose: "300–400 mg elemental/gün",
      timing: "Akşam (glisinat) veya sabah/akşam bölünmüş",
    },
    "omega-3": {
      category: "Temel Yağ Asidi",
      primaryBenefit: "Kalp sağlığı & Enflamasyon",
      pharmacistNote:
        "IFOS sertifikasını kontrol et. Veganlar için alg bazlı kullan. Balık yağı kokusu = enterik kaplı değil demektir.",
      bestForm: "Trigliserit formu (etil ester DEĞİL); yüksek EPA+DHA oranı",
      standardDose: "1.000–2.000 mg EPA+DHA/gün",
      timing: "En büyük öğünle",
    },
    probiotics: {
      category: "Bağırsak Sağlığı",
      primaryBenefit: "Sindirim sağlığı",
      pharmacistNote:
        "Suş spesifikliği önemlidir: L. rhamnosus GG (bağırsak), B. longum (ruh hali). Buzdolabında saklanan genellikle rafta durandan üstündür.",
      bestForm: "Çoklu suş (Lactobacillus + Bifidobacterium); suşa özgü seçim önemli",
      standardDose: "10–50 milyar CFU/gün",
      timing: "Sabah aç karnına veya uyumadan önce",
    },
    "vitamin-b12": {
      category: "Vitamin",
      primaryBenefit: "Enerji & Sinir fonksiyonu",
      pharmacistNote:
        "Vegan/vejetaryenler için kritik. Metformin B12'yi azaltır. Sublingual form, bağırsak emilim sorunlarını bypass eder.",
      bestForm: "Metilkobalamin veya Adenozilkobalamin (siyanokobalamin DEĞİL)",
      standardDose: "1.000–2.500 mcg/gün",
      timing: "Sabah",
    },
    zinc: {
      category: "Mineral",
      primaryBenefit: "Bağışıklık & Cilt sağlığı",
      pharmacistNote:
        "Mutlaka bakırla dengele (15 mg Zn'ye 2 mg Cu). Demir veya kalsiyumla birlikte alma — emilim için rekabet ederler.",
      bestForm: "Çinko pikolinat veya bisglisinat (oksit DEĞİL)",
      standardDose: "15–30 mg/gün",
      timing: "Yemekle (bulantıyı önler)",
    },
    ashwagandha: {
      category: "Adaptogen",
      primaryBenefit: "Stres azaltma",
      pharmacistNote:
        "Tiroid ilaçlarıyla kullanmaktan kaçın (tiroid hormonunu artırabilir). 8 hafta al, 2 hafta mola ver.",
      bestForm: "KSM-66 (kök ekstresi) veya Sensoril (kök+yaprak)",
      standardDose: "300–600 mg/gün (KSM-66)",
      timing: "Akşam (uyku için) veya sabah (stres için)",
    },
    curcumin: {
      category: "Anti-enflamatuvar",
      primaryBenefit: "Eklem ağrısı & Enflamasyon",
      pharmacistNote:
        "Piperin emilimi %2.000 artırır. Sade zerdeçal kapsülleri terapötik açıdan neredeyse işe yaramaz.",
      bestForm: "Piperin ile (BioPerine) veya liposomal veya Meriva (fitozom)",
      standardDose: "500–1.000 mg/gün",
      timing: "Öğünlerle",
    },
    collagen: {
      category: "Protein",
      primaryBenefit: "Cilt & Eklem desteği",
      pharmacistNote:
        "C Vitamini ile mutlaka birleştir — kolajen sentezi için zorunlu. Cilt için deniz > sığır. Sonuçlar 8–12 haftada görülür.",
      bestForm: "Hidrolize peptitler (I+III tip cilt için; II tip eklem için)",
      standardDose: "10–15 g/gün",
      timing: "Sabah (aç karnına) veya kahveye karıştırarak",
    },
    creatine: {
      category: "Performans",
      primaryBenefit: "Kas gücü & Güç",
      pharmacistNote:
        "Tarihin en fazla araştırılan takviyesi. Döngü yapmaya gerek yok. Yükleme yapmana gerek yok. Başlangıçta hafif su tutma olabilir.",
      bestForm: "Kreatin monohidrat (Creapure marka)",
      standardDose: "3–5 g/gün",
      timing: "Herhangi bir zamanda — günlük düzenlilik en önemli",
    },
    "vitamin-c": {
      category: "Vitamin",
      primaryBenefit: "Bağışıklık & Antioksidan",
      pharmacistNote:
        "Yüksek doz (5g+) sindirim sorunlarına yol açar. Demir emilimini artırmak için demirli yiyeceklerle al. Sigara içenler günde 35 mg daha fazlasına ihtiyaç duyar.",
      bestForm: "Askorbik asit (ekonomik) veya liposomal (premium emilim)",
      standardDose: "500–1.000 mg/gün",
      timing: "Bölünmüş dozlar (sabah + öğleden sonra)",
    },
    iron: {
      category: "Mineral",
      primaryBenefit: "Enerji & Kan sağlığı",
      pharmacistNote:
        "Kan testi ile eksiklik kanıtlanmadan takviye etme. Kalsiyum, çinko veya kahveyle birlikte alma. Tiroid ilaçlarından 4 saat ayrı al.",
      bestForm: "Bisglisinat (hafif, yüksek emilim) — demir sülfat DEĞİL",
      standardDose: "18–27 mg/gün (kadın), 8 mg/gün (erkek)",
      timing: "Aç karnına C vitaminiyle",
    },
    "l-theanine": {
      category: "Amino Asit",
      primaryBenefit: "Sakin odaklanma & Kaygı giderme",
      pharmacistNote:
        "200 mg L-theanine + 100 mg kafein = nootropik tatlı nokta. Uyuşukluk yaratmaz. Çoğu ilaçla güvenli.",
      bestForm: "Saf L-Teanin (Suntheanine marka premium)",
      standardDose: "100–200 mg/gün",
      timing: "Sabah kafeinle veya akşam uyku için",
    },
    "vitamin-k2": {
      category: "Vitamin",
      primaryBenefit: "Kemik & Kardiyovasküler sağlık",
      pharmacistNote:
        "D Vitamini alıyorsan kritik — D kalsiyum emilimini artırır, K2 nereye gideceğini yönlendirir. Warfarin ile KONTRENDİKE.",
      bestForm: "MK-7 (menakinon-7) — en uzun yarı ömür",
      standardDose: "100–200 mcg/gün",
      timing: "Sabah D3 ve yemekle",
    },
    coq10: {
      category: "Antioksidan",
      primaryBenefit: "Kalp sağlığı & Hücresel enerji",
      pharmacistNote:
        "Statin kullanan herkes için ZORUNLU — statinler CoQ10'u tüketerek kas ağrısına yol açar. 40 yaş üstü için Ubiquinol formu tercih edilir.",
      bestForm: "Ubikinol (aktif form, 40 yaş üstü için daha iyi) veya Ubikinon",
      standardDose: "100–200 mg/gün",
      timing: "Yağlı öğünle",
    },
    melatonin: {
      category: "Hormon",
      primaryBenefit: "Uykuya dalma",
      pharmacistNote:
        "Az, çoktan iyidir — 0,5 mg çoğu zaman 5 mg'dan daha iyi çalışır. Rehberlik olmadan uzun süreli günlük kullanım önerilmez.",
      bestForm: "Düşük doz (0,5–1 mg); uzun salınımlı uyku sürekliliği için",
      standardDose: "0,5–3 mg/gece",
      timing: "Yatmadan 30–60 dk önce, karanlıkta",
    },
    nac: {
      category: "Amino Asit",
      primaryBenefit: "Karaciğer desteği & Detoks",
      pharmacistNote:
        "Parasetamol toksisitesinde kanıtlanmış etkinliği var. OKB için gelişmekte olan kanıt. Oksidasyonu önlemek için C Vitamini ile al.",
      bestForm: "NAC standart — aç karnına alın",
      standardDose: "600–1.200 mg/gün",
      timing: "Sabah aç karnına",
    },
    berberine: {
      category: "Botanik",
      primaryBenefit: "Kan şekeri düzenlemesi",
      pharmacistNote:
        "GÜÇLÜ ilaç etkileşimleri — metformin mekanizmasını taklit eder. Metforminle birleştirme, doktor gözetimi olmadan. Kan basıncını düşürebilir.",
      bestForm: "Berberin HCl (standart) veya dihidroberberin (daha iyi emilim)",
      standardDose: "Günde 2–3 kez 500 mg, öğünlerle",
      timing: "Öğünlerle (GI yan etkileri azaltır)",
    },
    electrolytes: {
      category: "Mineral Kompleks",
      primaryBenefit: "Hidratasyon & Performans",
      pharmacistNote:
        "Oruç, keto ve yoğun terleme için kritik. Çoğu ticari spor içeceği çok fazla şeker, çok az sodyum içerir.",
      bestForm: "Dengeli oran: Na 1000mg, K 200mg, Mg 60mg/litre",
      standardDose: "Aktiviteye göre 1–2 porsiyon/gün",
      timing: "Egzersiz sırasında/sonrasında veya sabah",
    },
    "fiber-psyllium": {
      category: "Sindirim",
      primaryBenefit: "Bağırsak düzenliliği & Kolesterol",
      pharmacistNote:
        "Düşükten (3 g) başla, şişkinliği önlemek için yavaşça artır. Bol su içmek ŞART. İlaçlardan 2 saat ayrı al.",
      bestForm: "Psyllium kabuğu (çözünür) veya akasya lifi (prebiyotik)",
      standardDose: "5–10 g/gün, kademeli artış",
      timing: "Öğünlerden önce bol suyla",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ENGLISH
// ─────────────────────────────────────────────────────────────────────────────
const en: QuizTranslations = {
  ui: {
    awaiting: {
      title: 'Awaiting review',
      subtitle: (name) => `${name} is reviewing your supplement results.`,
      timerLabel: 'REVIEW CLOSES IN',
      infoText: 'A licensed pharmacist is checking your answers and may adjust your supplement plan before you see the final results.',
      cancelBtn: 'Choose a different pharmacist',
    },
    landing: {
      badge: "Pharmacist-Designed Quiz",
      titleLine1: "What Supplements",
      titleLine2: "Do You Actually Need?",
      subtitle:
        "Stop guessing. A licensed pharmacist built this quiz to cut through the noise — get a personalized supplement stack based on your health goals, medications, and lifestyle. With interaction safety screening no influencer quiz can match.",
      cta: "Take the Free Quiz →",
      minutes: "3 minutes",
      questions: "16 questions",
      free: "100% free",
      trustPharmacist: "Built by a licensed pharmacist",
      trustInteraction: "Drug interaction screening",
      trustEvidence: "Evidence-based recommendations",
      whatYouGetTitle: "What You'll Get",
      feature1Title: "Personalized Stack",
      feature1Desc:
        "Supplements chosen specifically for your age, goals, diet, and lifestyle — not generic advice.",
      feature2Title: "Safety Screening",
      feature2Desc:
        "Your stack is cross-checked against your medications for dangerous interactions. No influencer does this.",
      feature3Title: "Timing Schedule",
      feature3Desc:
        "Exactly when to take each supplement and why — because timing affects absorption by up to 75%.",
      readyCTA: "Ready to find out what you actually need?",
      startCTA: "Start the Quiz →",
    },
    quiz: {
      back: "← Back",
      continue: "Continue →",
      skip: "Skip →",
      selectAll: "Select all that apply",
      of: "of",
      other: "Something Else",
      otherPlaceholder: "Type and press Enter...",
    },
    results: {
      badge: "Your Personalized Results",
      title: "Your Supplement Stack",
      recommendedTitle: "Your Recommended Supplements",
      interactionTitle: "Interaction Alerts",
      scheduleTitle: "Your Daily Timing Schedule",
      scheduleNote:
        "Timing affects absorption by up to 75%. Follow this schedule for maximum effectiveness.",
      notesTitle: "Important Notes",
      retake: "← Retake Quiz",
      share: "Share Your Results 📤",
      shareText:
        "I just got my personalized supplement stack from a pharmacist-designed quiz!",
      linkCopied: "Link copied to clipboard!",
      downloadPdf: "Download PDF ↓",
      priority: {
        essential: "Essential",
        recommended: "Recommended",
        optional: "Optional",
      },
      bestForm: "Best form",
      dose: "Dose",
      timing: "Timing",
      withFood: "With food",
      withFoodYes: "Yes ✓",
      withFoodNo: "No — empty stomach",
      withFoodOptional: "Optional",
      pharmacistTip: "💡 Pharmacist tip:",
      viewProduct: "Shop this product →",
      evidenceLabel: "Evidence",
      perMonth: "/mo",
      back: "← Back",
      backToApp: "← Back to app",
    },
    loading: {
      title: "Designing Your Stack",
      subtitle: "Your pharmacist is reviewing your answers...",
      steps: [
        { emoji: "🔍", text: "Analyzing your profile..." },
        { emoji: "💊", text: "Matching supplements to your goals..." },
        { emoji: "⚠️", text: "Screening for drug interactions..." },
        { emoji: "⏰", text: "Building your timing schedule..." },
        { emoji: "✅", text: "Finalizing your stack..." },
      ],
    },
  },

  engine: {
    goalLabels: {
      energy: "Energy & Vitality",
      sleep: "Better Sleep",
      immunity: "Immune Support",
      joints: "Joint Health",
      stress: "Stress & Anxiety Relief",
      cognitive: "Brain & Focus",
      athletic: "Athletic Performance",
      gut: "Gut Health",
      heart: "Heart Health",
      skin: "Skin, Hair & Nails",
      weight: "Weight Management",
      longevity: "Longevity & Anti-Aging",
    },
    coreReason: (g) => `Core supplement for ${g}`,
    supportsReason: (g) => `Supports ${g}`,
    additionalReason: (g) => `Additional support for ${g}`,
    secondaryKeyReason: (g) => `Key for secondary goal: ${g}`,
    secondarySupportsReason: (g) => `Supports ${g}`,
    reasons: {
      veganB12: "Critical for vegans — plant foods contain no B12",
      veganIron: "Vegans are at higher risk of iron deficiency",
      veganOmega3:
        "Use algae-based — essential fatty acids missing from vegan diets",
      vegetarianB12: "Vegetarians often have suboptimal B12 levels",
      ketoElectrolytes:
        "Keto depletes electrolytes rapidly — the 'keto flu' is usually electrolyte deficiency",
      ketoMagnesium: "Keto increases magnesium loss",
      minimalSunD3:
        "Mostly indoors = almost certainly Vitamin D deficient. Highest-impact single supplement.",
      highStressAshwagandha:
        "High stress depletes magnesium and B vitamins faster",
      highStressMagnesium: "Stress increases magnesium burn rate",
      poorSleepMagnesium:
        "Poor sleep — magnesium glycinate activates GABA for relaxation",
      poorSleepTheanine:
        "Promotes alpha brain waves for easier sleep onset",
      heavyCreatine:
        "Heavy training — creatine supports power output and recovery",
      heavyElectrolytes: "Heavy sweating depletes minerals significantly",
      femalePre:
        "Premenopausal women have higher iron needs due to menstruation",
      femalePostD3: "Bone density protection post-menopause",
      femalePostK2: "Directs calcium to bones (critical post-menopause)",
      statinsCoq10:
        "Statins deplete CoQ10 — the #1 cause of statin muscle pain. This is the mandatory companion to your statin.",
      metforminB12:
        "Metformin is proven to deplete B12 over time. Get levels checked annually.",
      coq10AgeSuffix:
        " Use Ubiquinol form — conversion ability declines after 40.",
      algaeAllergySuffix:
        " (Use ALGAE-BASED — not fish oil due to your allergy)",
      sym: {
        fatigue: "Directly addresses your chronic fatigue and low energy",
        afternoonCrash: "Supports sustained energy to prevent afternoon crashes",
        unrefreshedSleep: "Supports sleep depth and waking refreshed",
        brainFog: "Directly targets brain fog, concentration, and memory",
        anxiety: "Clinically backed for anxiety and the stress response",
        lowMood: "Supports neurotransmitter balance for mood",
        irritability: "Irritability depletes magnesium and B vitamins faster",
        stressOverwhelm: "Adaptogenic support for stress resilience",
        sleepOnset: "Supports GABA activation and sleep onset",
        sleepQuality: "Supports sleep continuity and deep sleep",
        brittleNails: "Zinc and collagen are key structural nutrients for nails",
        hairLoss: "Addresses zinc, collagen, and iron as common causes of hair loss",
        drySkin: "Omega-3 and collagen support skin barrier and hydration",
        slowHealing: "Vitamin C and zinc are essential for tissue repair",
        graying: "B12 deficiency is linked to premature graying",
        cramps: "Magnesium and electrolyte deficiency is the most common cause of cramps",
        jointPain: "Omega-3 and curcumin reduce joint inflammation and stiffness",
        weakness: "B12 and iron deficiency are frequent causes of general weakness",
        slowRecovery: "Supports post-exercise recovery and muscle repair",
        frequentIllness: "Core immune support: Vitamin D, zinc, and Vitamin C",
        allergies: "Modulates immune overreaction and seasonal allergy severity",
        bloating: "Probiotics and fiber restore gut balance and reduce bloating",
        indigestion: "Probiotic support for digestive enzyme balance",
        constipation: "Psyllium fiber and magnesium support bowel regularity",
        foodSens: "Gut microbiome and barrier integrity for food sensitivity",
        boneDensity: "Critical bone density support: D3, K2, and magnesium",
        agingDecline: "Anti-aging brain and cellular energy support",
        restrictiveDiet: "Fills key nutrient gaps from restrictive eating",
        pregnancy: "Supports maternal and fetal health during pregnancy",
        postSurgery: "Supports tissue healing and recovery post-surgery",
        poorNutrition: "Corrects common deficiencies from an unvaried diet",
        muscleBuilding: "Creatine is the most evidence-backed supplement for muscle gain",
        weightGoal: "Supports satiety and blood sugar for weight management",
        gymPerformance: "Supports gym output, endurance, and recovery",
        attention: "Omega-3 and L-theanine improve attention and focus",
        poorAppetite: "Zinc deficiency is a frequent and reversible cause of poor appetite",
        sugarCravings: "Berberine and fiber regulate blood sugar and reduce cravings",
        poorSatiety: "Fiber and berberine improve satiety signaling",
      },
    },
    doseAdjustments: {
      vitaminD3LowSun:
        "Start at 4,000 IU/day (higher dose due to minimal sun exposure)",
      b12Vegan: "2,500 mcg/day (higher dose as sole source)",
      magnesiumHeavy: "400–500 mg/day (increased due to heavy training)",
      electrolytesKeto: "2–3 servings/day during keto adaptation",
    },
    timingSlots: {
      morning: "Morning (with breakfast)",
      midMorning: "Mid-morning",
      lunch: "Lunch",
      evening: "Evening (before bed)",
      anytime: "Any time (consistency matters)",
    },
    timingNotes: {
      iron: "Take with Vitamin C, away from coffee",
      fiber: "With a large glass of water",
      takeWithFood: "Take with food",
    },
    summary: (count, primary, secondary, essentialCount, totalWarnings) =>
      `Based on your profile, I've designed a ${count}-supplement stack targeting ${primary}${
        secondary ? ` and ${secondary}` : ""
      }. ${essentialCount} supplements are essential for your specific situation${
        totalWarnings > 0
          ? `, and I've flagged ${totalWarnings} interaction(s) to be aware of`
          : ""
      }.`,
    disclaimers: {
      base: [
        "This quiz provides educational guidance and does not replace professional medical advice.",
        "Consult your healthcare provider before starting any supplement regimen.",
      ],
      removedSupplements: (count, names) =>
        `${count} supplement(s) were excluded due to interactions with your medications: ${names}.`,
      bloodThinners:
        "You are on blood thinners. Every new supplement should be cleared with your pharmacist or doctor.",
    },
  },

  questions: {
    age: {
      section: "About You",
      question: "What is your age range?",
      options: {
        "20-30": { label: "20–30" },
        "30-40": { label: "30–40" },
        "40-50": { label: "40–50" },
        "50-60": { label: "50–60" },
      },
    },
    sex: {
      section: "About You",
      question: "What is your biological sex?",
      subtitle: "This affects nutrient requirements and dosing recommendations.",
      options: {
        male: { label: "Male" },
        female: { label: "Female" },
      },
    },
    menopause: {
      section: "About You",
      question: "Are you menopausal?",
      options: {
        post: { label: "Yes (in menopause)" },
        pre: { label: "No (not in menopause)" },
        unsure: { label: "Transitioning to menopause (Peri-menopause)" },
      },
    },
    medications: {
      section: "About You",
      question: "Are you currently taking any medications?",
      subtitle:
        "This is critical for checking supplement-drug interactions. Select all that apply.",
      options: {
        statins: { label: "Statins (cholesterol)" },
        metformin: { label: "Metformin (diabetes)" },
        "blood-thinners": { label: "Blood thinners (warfarin, etc.)" },
        thyroid: { label: "Thyroid medication" },
        ssri: { label: "Antidepressants (SSRIs)" },
        ppi: { label: "Acid reflux / PPIs" },
        "bp-meds": { label: "Blood pressure medication" },
        "birth-control": { label: "Birth control" },
        antihistamines: { label: "Antihistamines (cetirizine, loratadine)" },
        corticosteroids: { label: "Corticosteroids (prednisone)" },
        "osteoporosis-meds": { label: "Osteoporosis meds (bisphosphonates)" },
        "sleep-aids": { label: "Sleep aids (zolpidem, benzodiazepines)" },
        antibiotics: { label: "Antibiotics (current course)" },
        antifungals: { label: "Antifungals" },
        immunosuppressants: { label: "Immunosuppressants" },
        "seizure-meds": { label: "Seizure medications (anticonvulsants)" },
        hrt: { label: "Hormone replacement therapy (HRT)" },
        "anti-asthmatic": { label: "Anti-asthmatic (inhalers, montelukast)" },
        "anti-neoplastic": { label: "Anti-neoplastic (chemotherapy)" },
        none: { label: "None" },
      },
    },
    diet: {
      section: "Your Lifestyle",
      question: "How would you describe your diet?",
      options: {
        omnivore: { label: "Omnivore", description: "Eat everything" },
        vegetarian: {
          label: "Vegetarian",
          description: "No meat, but eggs/dairy",
        },
        vegan: { label: "Vegan", description: "Fully plant-based" },
        keto: {
          label: "Keto / Low-Carb",
          description: "High fat, low carb",
        },
        mediterranean: {
          label: "Mediterranean",
          description: "Whole foods, olive oil, fish",
        },
        "no-specific": {
          label: "No specific diet",
          description: "I eat what I eat",
        },
      },
    },
    exercise: {
      section: "Your Lifestyle",
      question: "How often do you exercise?",
      options: {
        rarely: { label: "Rarely", description: "Less than once a week" },
        light: { label: "1–2x per week", description: "Light activity" },
        moderate: { label: "3–4x per week", description: "Regular workouts" },
        heavy: { label: "5+ days per week", description: "Serious training" },
      },
    },
    stress: {
      section: "Your Lifestyle",
      question: "How would you rate your stress level?",
      options: {
        low: { label: "Low (1–3)", description: "Generally relaxed" },
        moderate: {
          label: "Moderate (4–6)",
          description: "Normal life stress",
        },
        high: {
          label: "High (7–10)",
          description: "Frequently overwhelmed",
        },
      },
    },
    sleep: {
      section: "Your Lifestyle",
      question: "How is your sleep quality?",
      options: {
        great: {
          label: "Great",
          description: "Fall asleep easily, stay asleep",
        },
        okay: { label: "Okay", description: "Occasional issues" },
        poor: {
          label: "Poor",
          description: "Regular trouble falling or staying asleep",
        },
      },
    },
    sun: {
      section: "Your Lifestyle",
      question: "How much sun exposure do you get daily?",
      options: {
        lots: { label: "Lots", description: "Outdoor job or lifestyle" },
        some: { label: "Some", description: "30+ minutes per day" },
        minimal: { label: "Minimal", description: "Mostly indoors" },
      },
    },
    "primary-goal": {
      section: "Your Goals",
      question: "What is your primary health goal?",
      subtitle: "Choose the one that matters most to you right now.",
      options: {
        energy: { label: "Energy & Vitality" },
        sleep: { label: "Better Sleep" },
        immunity: { label: "Immune Support" },
        joints: { label: "Joint Health & Mobility" },
        stress: { label: "Stress & Anxiety" },
        cognitive: { label: "Brain & Focus" },
        athletic: { label: "Athletic Performance" },
        gut: { label: "Gut Health & Digestion" },
        heart: { label: "Heart Health" },
        skin: { label: "Skin, Hair & Nails" },
        weight: { label: "Weight Management" },
        longevity: { label: "Longevity & Anti-Aging" },
      },
    },
    "secondary-goal": {
      section: "Your Goals",
      question: "Do you have a secondary health goal?",
      options: {
        energy: { label: "Energy & Vitality" },
        sleep: { label: "Better Sleep" },
        immunity: { label: "Immune Support" },
        joints: { label: "Joint Health" },
        stress: { label: "Stress & Anxiety" },
        cognitive: { label: "Brain & Focus" },
        athletic: { label: "Athletic Performance" },
        gut: { label: "Gut Health" },
        heart: { label: "Heart Health" },
        skin: { label: "Skin, Hair & Nails" },
        weight: { label: "Weight Management" },
        longevity: { label: "Longevity" },
        none: { label: "No secondary goal" },
      },
    },
    complaints: {
      section: "Your Complaints",
      question: "What are your current complaints or concerns?",
      subtitle: "Select all that apply — this helps tailor your stack to your actual symptoms.",
      options: {
        "chronic-fatigue": { label: "Chronic fatigue / always tired", group: "Energy & Fatigue" },
        "afternoon-crash": { label: "Afternoon energy crashes", group: "Energy & Fatigue" },
        "unrefreshed-sleep": { label: "Waking unrefreshed / not rested", group: "Energy & Fatigue" },
        "brain-fog": { label: "Brain fog, poor concentration, forgetfulness", group: "Energy & Fatigue" },
        "anxiety": { label: "Anxiety or worry", group: "Mood, Stress & Sleep" },
        "low-mood": { label: "Low mood / sadness", group: "Mood, Stress & Sleep" },
        "irritability": { label: "Irritability / mood swings", group: "Mood, Stress & Sleep" },
        "stress-overwhelm": { label: "Difficulty coping with stress", group: "Mood, Stress & Sleep" },
        "trouble-falling-asleep": { label: "Trouble falling asleep", group: "Mood, Stress & Sleep" },
        "waking-at-night": { label: "Waking at night / restless sleep", group: "Mood, Stress & Sleep" },
        "brittle-nails": { label: "Brittle or weak nails", group: "Hair, Skin & Nails" },
        "hair-loss": { label: "Hair thinning or shedding", group: "Hair, Skin & Nails" },
        "dry-skin": { label: "Dry or flaky skin", group: "Hair, Skin & Nails" },
        "slow-healing": { label: "Slow wound healing", group: "Hair, Skin & Nails" },
        "premature-graying": { label: "Premature graying", group: "Hair, Skin & Nails" },
        "muscle-cramps": { label: "Muscle cramps or twitching", group: "Muscle, Joint & Recovery" },
        "joint-stiffness": { label: "Joint stiffness or aches", group: "Muscle, Joint & Recovery" },
        "general-weakness": { label: "General muscle weakness", group: "Muscle, Joint & Recovery" },
        "slow-recovery": { label: "Slow recovery after exercise", group: "Muscle, Joint & Recovery" },
        "frequent-illness": { label: "Frequent colds, infections, or slow healing", group: "Immunity" },
        "seasonal-allergies": { label: "Worsening seasonal allergies", group: "Immunity" },
        "bloating-gas": { label: "Bloating or gas", group: "Digestion & Gut" },
        "indigestion": { label: "Indigestion / heartburn", group: "Digestion & Gut" },
        "constipation": { label: "Constipation", group: "Digestion & Gut" },
        "food-sensitivities": { label: "Food sensitivities or discomfort after eating", group: "Digestion & Gut" },
        "bone-density-concern": { label: "Bone density or osteoporosis concern", group: "Bone Health & Aging" },
        "age-related-decline": { label: "Age-related memory, energy, or vision decline", group: "Bone Health & Aging" },
        "restrictive-diet": { label: "Vegan or very restrictive diet", group: "Dietary Gaps & Life Stages" },
        "pregnancy-planning": { label: "Pregnant or trying to conceive", group: "Dietary Gaps & Life Stages" },
        "post-surgery": { label: "Post-surgery or injury recovery", group: "Dietary Gaps & Life Stages" },
        "poor-nutrition": { label: "Not eating enough variety or skipping meals", group: "Dietary Gaps & Life Stages" },
        "muscle-building": { label: "Building muscle mass", group: "Fitness & Body Goals" },
        "weight-management-goal": { label: "Weight management or fat loss", group: "Fitness & Body Goals" },
        "gym-performance": { label: "Gym performance or endurance", group: "Fitness & Body Goals" },
        "attention-focus": { label: "Difficulty focusing, easily distracted, trouble completing tasks", group: "Attention & Focus" },
        "poor-appetite": { label: "Poor appetite or eating too little", group: "Appetite" },
        "sugar-cravings": { label: "Sugar cravings or overeating", group: "Appetite" },
        "poor-satiety": { label: "Low sense of fullness after meals", group: "Appetite" },
        none: { label: "No complaints" },
      },
    },
    allergies: {
      section: "Preferences",
      question: "Do you have any allergies or sensitivities?",
      subtitle:
        "Select all that apply. This filters out unsafe product recommendations.",
      options: {
        shellfish: { label: "Shellfish" },
        soy: { label: "Soy" },
        gluten: { label: "Gluten" },
        fish: { label: "Fish" },
        dairy: { label: "Dairy" },
        none: { label: "None" },
      },
    },
    form: {
      section: "Preferences",
      question: "What form of supplements do you prefer?",
      options: {
        capsules: { label: "Capsules / Tablets" },
        gummies: { label: "Gummies" },
        powder: { label: "Powder" },
        liquid: { label: "Liquid" },
        "no-preference": { label: "No preference" },
      },
    },
    currency: {
      section: "Preferences",
      question: "What currency do you prefer?",
      options: {
        usd: { label: "USD ($)" },
        eur: { label: "EUR (€)" },
        gbp: { label: "GBP (£)" },
        try: { label: "TRY (₺)" },
      },
    },
    budget: {
      section: "Preferences",
      question: "What's your monthly supplement budget?",
      options: {
        starter: {
          label: "Starter",
          description: "$15–25 / €14–23 / £12–20 / ₺510–850",
        },
        budget: {
          label: "Budget",
          description: "$25–50 / €23–46 / £20–40 / ₺850–1,700",
        },
        mid: {
          label: "Mid-Range",
          description: "$50–100 / €46–92 / £40–80 / ₺1,700–3,400",
        },
        premium: {
          label: "Premium",
          description: "$100–150 / €92–138 / £80–120 / ₺3,400–5,100",
        },
        ultra: {
          label: "Ultra",
          description: "$150+ / €138+ / £120+ / ₺5,100+",
        },
      },
    },
    newsletter: {
      section: "Stay Updated",
      question: "Want monthly pharmacist-vetted supplement insights?",
      subtitle:
        "Join our free newsletter — new research, myth-busting, and product alerts.",
      options: {
        yes: { label: "Yes, sign me up!" },
        no: { label: "No thanks, just show my results" },
      },
    },
  },

  supplements: {
    "vitamin-d3": {
      category: "Vitamin",
      primaryBenefit: "Bone health & Immunity",
      pharmacistNote:
        "Pair with K2 (MK-7) for proper calcium routing. Test blood levels first if possible. Target 40–60 ng/mL.",
    },
    magnesium: {
      category: "Mineral",
      primaryBenefit: "Sleep & Muscle relaxation",
      pharmacistNote:
        "Oxide form has poor absorption (~4%). Glycinate is the gold standard. Most adults are deficient.",
    },
    "omega-3": {
      category: "Essential Fatty Acid",
      primaryBenefit: "Heart health & Inflammation",
      pharmacistNote:
        "Check for IFOS certification. Burpless = enteric coated. Algae-based for vegans.",
    },
    probiotics: {
      category: "Gut Health",
      primaryBenefit: "Digestive health",
      pharmacistNote:
        "Strain specificity matters: L. rhamnosus GG (gut), B. longum (mood). Refrigerated > shelf-stable usually.",
    },
    "vitamin-b12": {
      category: "Vitamin",
      primaryBenefit: "Energy & Nerve function",
      pharmacistNote:
        "Critical for vegans/vegetarians. Metformin depletes B12. Sublingual bypasses gut absorption issues.",
    },
    zinc: {
      category: "Mineral",
      primaryBenefit: "Immunity & Skin health",
      pharmacistNote:
        "MUST balance with copper (2 mg Cu per 15 mg Zn). Don't take with iron or calcium — they compete for absorption.",
    },
    ashwagandha: {
      category: "Adaptogen",
      primaryBenefit: "Stress reduction",
      pharmacistNote:
        "Avoid with thyroid medications (can increase thyroid hormone). Nightshade family. Cycle 8 weeks on, 2 off.",
    },
    curcumin: {
      category: "Anti-inflammatory",
      primaryBenefit: "Joint pain & Inflammation",
      pharmacistNote:
        "Piperine increases absorption 2,000%. Plain turmeric capsules are essentially useless therapeutically.",
    },
    collagen: {
      category: "Protein",
      primaryBenefit: "Skin & Joint support",
      pharmacistNote:
        "Must combine with Vitamin C for collagen synthesis. Marine > bovine for skin. Results take 8–12 weeks.",
    },
    creatine: {
      category: "Performance",
      primaryBenefit: "Muscle strength & Power",
      pharmacistNote:
        "Most researched supplement in history. No need to cycle. No need to load. May cause minor water retention initially.",
    },
    "vitamin-c": {
      category: "Vitamin",
      primaryBenefit: "Immunity & Antioxidant",
      pharmacistNote:
        "Megadosing (5g+) causes GI distress. Take with iron-rich foods to boost iron absorption. Smokers need 35 mg more/day.",
    },
    iron: {
      category: "Mineral",
      primaryBenefit: "Energy & Blood health",
      pharmacistNote:
        "DON'T supplement without confirmed deficiency (blood test). Never take with calcium, zinc, or coffee. Separate from thyroid meds by 4 hours.",
    },
    "l-theanine": {
      category: "Amino Acid",
      primaryBenefit: "Calm focus & Anxiety relief",
      pharmacistNote:
        "200 mg L-theanine + 100 mg caffeine = the nootropic sweet spot. No drowsiness. Safe with most medications.",
    },
    "vitamin-k2": {
      category: "Vitamin",
      primaryBenefit: "Bone & Cardiovascular health",
      pharmacistNote:
        "CRITICAL if taking Vitamin D — D increases calcium absorption, K2 directs where it goes. CONTRAINDICATED with warfarin.",
    },
    coq10: {
      category: "Antioxidant",
      primaryBenefit: "Heart health & Cellular energy",
      pharmacistNote:
        "ESSENTIAL for anyone on statins — statins deplete CoQ10 causing muscle pain. Ubiquinol form preferred after age 40.",
    },
    melatonin: {
      category: "Hormone",
      primaryBenefit: "Sleep onset",
      pharmacistNote:
        "Less is more — 0.5 mg often works better than 5 mg. Not for long-term daily use without guidance. Can worsen depression in some.",
    },
    nac: {
      category: "Amino Acid",
      primaryBenefit: "Liver support & Detox",
      pharmacistNote:
        "Proven for acetaminophen toxicity. Emerging evidence for OCD/trichotillomania. Take with Vitamin C to prevent oxidation.",
    },
    berberine: {
      category: "Botanical",
      primaryBenefit: "Blood sugar regulation",
      pharmacistNote:
        "STRONG drug interactions — mimics metformin mechanism. Don't combine with metformin without MD oversight. Can lower blood pressure.",
    },
    electrolytes: {
      category: "Mineral Complex",
      primaryBenefit: "Hydration & Performance",
      pharmacistNote:
        "Critical for fasting, keto, heavy sweating. Most commercial sports drinks have too much sugar, too little sodium.",
    },
    "fiber-psyllium": {
      category: "Digestive",
      primaryBenefit: "Gut regularity & Cholesterol",
      pharmacistNote:
        "Start low (3 g) and increase slowly to avoid bloating. MUST drink adequate water. Separate from medications by 2 hours.",
    },
  },
};

import { ar } from './translations.ar'
import { ru } from './translations.ru'
import { el } from './translations.el'
import { fr } from './translations.fr'
import { es } from './translations.es'
import { de } from './translations.de'
import { fa } from './translations.fa'

export const translations: Record<Lang, QuizTranslations> = { tr, en, ar, ru, el, fr, es, de, fa };

export function getT(lang: Lang): QuizTranslations {
  return translations[lang];
}
