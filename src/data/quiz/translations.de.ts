import type { QuizTranslations } from './translations'

export const de: QuizTranslations = {
  ui: {
    awaiting: {
      title: 'Warte auf Überprüfung',
      subtitle: (name) => `${name} überprüft gerade deine Nahrungsergänzungsmittel-Ergebnisse.`,
      timerLabel: 'ÜBERPRÜFUNG ENDET IN',
      infoText: 'Ein zugelassener Apotheker prüft deine Antworten und kann deinen Ergänzungsplan anpassen, bevor du die endgültigen Ergebnisse siehst.',
      cancelBtn: 'Anderen Apotheker wählen',
    },
    landing: {
      badge: "Von Apothekern entwickelter Quiz",
      titleLine1: "Welche Nahrungsergänzungsmittel",
      titleLine2: "brauchst du wirklich?",
      subtitle:
        "Hör auf zu raten. Ein zugelassener Apotheker hat diesen Quiz entwickelt, um Wahrheit von Marketing zu trennen — erhalte einen personalisierten Ergänzungsplan abgestimmt auf deine Gesundheitsziele, Medikamente und Lebensweise. Mit einer Wechselwirkungsprüfung, die kein Influencer bieten kann.",
      cta: "Kostenlosen Quiz starten →",
      minutes: "3 Minuten",
      questions: "16 Fragen",
      free: "100 % kostenlos",
      trustPharmacist: "Entwickelt von einem zugelassenen Apotheker",
      trustInteraction: "Prüfung auf Arzneimittelwechselwirkungen",
      trustEvidence: "Evidenzbasierte Empfehlungen",
      whatYouGetTitle: "Was du erhältst",
      feature1Title: "Persönlicher Plan",
      feature1Desc:
        "Nahrungsergänzungsmittel, die speziell auf dein Alter, deine Ziele, deine Ernährung und deinen Lebensstil abgestimmt sind — keine allgemeinen Ratschläge.",
      feature2Title: "Sicherheitsprüfung",
      feature2Desc:
        "Dein Plan wird gegen deine Medikamente auf gefährliche Wechselwirkungen geprüft. Das macht kein Influencer.",
      feature3Title: "Einnahmeplan",
      feature3Desc:
        "Genau wann du jedes Präparat einnehmen solltest und warum — denn der Einnahmezeitpunkt beeinflusst die Aufnahme um bis zu 75 %.",
      readyCTA: "Bereit herauszufinden, was du wirklich brauchst?",
      startCTA: "Quiz starten →",
    },
    quiz: {
      back: "← Zurück",
      continue: "Weiter →",
      skip: "Überspringen →",
      selectAll: "Alle zutreffenden auswählen",
      of: "von",
      other: "Sonstiges",
      otherPlaceholder: "Eingeben und Enter drücken...",
    },
    results: {
      badge: "Deine personalisierten Ergebnisse",
      title: "Dein Ergänzungsplan",
      recommendedTitle: "Deine empfohlenen Nahrungsergänzungsmittel",
      interactionTitle: "Wechselwirkungshinweise",
      scheduleTitle: "Dein täglicher Einnahmeplan",
      scheduleNote:
        "Der Einnahmezeitpunkt beeinflusst die Absorption um bis zu 75 %. Halte dich für maximale Wirksamkeit an diesen Plan.",
      notesTitle: "Wichtige Hinweise",
      retake: "← Quiz wiederholen",
      share: "Ergebnisse teilen 📤",
      shareText:
        "Ich habe gerade meinen personalisierten Ergänzungsplan von einem apothekerentwickelten Quiz erhalten!",
      linkCopied: "Link in die Zwischenablage kopiert!",
      downloadPdf: "PDF herunterladen ↓",
      priority: {
        essential: "Essenziell",
        recommended: "Empfohlen",
        optional: "Optional",
      },
      bestForm: "Beste Form",
      dose: "Dosis",
      timing: "Einnahmezeitpunkt",
      withFood: "Mit dem Essen",
      withFoodYes: "Ja ✓",
      withFoodNo: "Nein — auf nüchternen Magen",
      withFoodOptional: "Optional",
      pharmacistTip: "💡 Apothekertipp:",
      viewProduct: "Produkt kaufen →",
      evidenceLabel: "Evidenz",
      perMonth: "/Monat",
      back: "← Zurück",
      backToApp: "← Zurück zur App",
    },
    loading: {
      title: "Dein Plan wird erstellt",
      subtitle: "Dein Apotheker überprüft deine Antworten...",
      steps: [
        { emoji: "🔍", text: "Dein Profil wird analysiert..." },
        { emoji: "💊", text: "Präparate werden deinen Zielen zugeordnet..." },
        { emoji: "⚠️", text: "Arzneimittelwechselwirkungen werden geprüft..." },
        { emoji: "⏰", text: "Dein Einnahmeplan wird erstellt..." },
        { emoji: "✅", text: "Dein Plan wird finalisiert..." },
      ],
    },
  },

  engine: {
    goalLabels: {
      energy: "Energie & Vitalität",
      sleep: "Besserer Schlaf",
      immunity: "Immununterstützung",
      joints: "Gelenkgesundheit",
      stress: "Stress- & Angstabbau",
      cognitive: "Gehirn & Fokus",
      athletic: "Sportliche Leistung",
      gut: "Darmgesundheit",
      heart: "Herzgesundheit",
      skin: "Haut, Haare & Nägel",
      weight: "Gewichtsmanagement",
      longevity: "Langlebigkeit & Anti-Aging",
    },
    coreReason: (g) => `Kernpräparat für ${g}`,
    supportsReason: (g) => `Unterstützt ${g}`,
    additionalReason: (g) => `Zusätzliche Unterstützung für ${g}`,
    secondaryKeyReason: (g) => `Essenziell für sekundäres Ziel: ${g}`,
    secondarySupportsReason: (g) => `Unterstützt ${g}`,
    reasons: {
      veganB12: "Kritisch für Veganer — pflanzliche Lebensmittel enthalten kein B12",
      veganIron: "Veganer haben ein höheres Risiko für Eisenmangel",
      veganOmega3:
        "Algenbasiertes Produkt verwenden — essentielle Fettsäuren fehlen in veganer Ernährung",
      vegetarianB12: "Vegetarier haben oft suboptimale B12-Spiegel",
      ketoElectrolytes:
        "Keto erschöpft Elektrolyte schnell — die 'Keto-Grippe' ist meist ein Elektrolytmangel",
      ketoMagnesium: "Keto erhöht den Magnesiumverlust",
      minimalSunD3:
        "Überwiegend drinnen = Vitamin-D-Mangel so gut wie sicher. Das Präparat mit dem höchsten Einzeleffekt.",
      highStressAshwagandha:
        "Hoher Stress erschöpft Magnesium und B-Vitamine schneller",
      highStressMagnesium: "Stress beschleunigt den Magnesiumverbrauch",
      poorSleepMagnesium:
        "Schlechter Schlaf — Magnesiumglycinat aktiviert GABA zur Entspannung",
      poorSleepTheanine:
        "Fördert Alpha-Gehirnwellen für leichteres Einschlafen",
      heavyCreatine:
        "Intensives Training — Kreatin unterstützt Kraftleistung und Erholung",
      heavyElectrolytes: "Starkes Schwitzen erschöpft Mineralstoffe erheblich",
      femalePre:
        "Prämenopausale Frauen haben durch die Menstruation einen höheren Eisenbedarf",
      femalePostD3: "Schutz der Knochendichte nach der Menopause",
      femalePostK2: "Leitet Kalzium in die Knochen (nach der Menopause essenziell)",
      statinsCoq10:
        "Statine erschöpfen CoQ10 — die Hauptursache für statinbedingte Muskelschmerzen. Dies ist die unverzichtbare Ergänzung zu deinem Statin.",
      metforminB12:
        "Es ist belegt, dass Metformin langfristig B12 erschöpft. Lass deine Werte jährlich kontrollieren.",
      coq10AgeSuffix:
        " Ubiquinol-Form verwenden — die Umwandlungsfähigkeit nimmt ab 40 Jahren ab.",
      algaeAllergySuffix:
        " (ALGENBASIERTES Produkt verwenden — kein Fischöl wegen deiner Allergie)",
      sym: {
        fatigue: "Geht direkt auf deine chronische Müdigkeit und Energielosigkeit ein",
        afternoonCrash: "Unterstützt gleichmäßige Energie, um den Nachmittagstief zu vermeiden",
        unrefreshedSleep: "Verbessert Schlaftiefe und erholtes Aufwachen",
        brainFog: "Wirkt direkt gegen Gehirnnebel, Konzentrationsprobleme und Vergesslichkeit",
        anxiety: "Klinisch belegt bei Angst und Stressreaktion",
        lowMood: "Unterstützt das Neurotransmitter-Gleichgewicht für die Stimmung",
        irritability: "Reizbarkeit erschöpft Magnesium und B-Vitamine schneller",
        stressOverwhelm: "Adaptogene Unterstützung für Stressresistenz",
        sleepOnset: "Unterstützt GABA-Aktivierung und Einschlafen",
        sleepQuality: "Unterstützt Schlafkontinuität und Tiefschlaf",
        brittleNails: "Zink und Kollagen sind wesentliche Strukturnährstoffe für Nägel",
        hairLoss: "Adressiert Zink, Kollagen und Eisen als häufige Ursachen von Haarausfall",
        drySkin: "Omega-3 und Kollagen unterstützen die Hautbarriere und Feuchtigkeitsversorgung",
        slowHealing: "Vitamin C und Zink sind essenziell für die Gewebereparatur",
        graying: "B12-Mangel ist mit frühzeitigem Ergrauen verbunden",
        cramps: "Magnesium- und Elektrolytmangel ist die häufigste Ursache von Krämpfen",
        jointPain: "Omega-3 und Curcumin reduzieren Gelenkentzündung und Steifheit",
        weakness: "B12- und Eisenmangel sind häufige Ursachen allgemeiner Schwäche",
        slowRecovery: "Unterstützt die Erholung nach dem Training und die Muskelreparatur",
        frequentIllness: "Grundlegende Immununterstützung: Vitamin D, Zink und Vitamin C",
        allergies: "Moduliert Immunüberreaktion und Schwere saisonaler Allergien",
        bloating: "Probiotika und Ballaststoffe stellen das Darmgleichgewicht wieder her und reduzieren Blähungen",
        indigestion: "Probiotische Unterstützung für das Verdauungsenzymgleichgewicht",
        constipation: "Flohsamenschalen und Magnesium unterstützen die Darmregelmäßigkeit",
        foodSens: "Darmmikrobiom und Barriere-Integrität bei Nahrungsmittelunverträglichkeiten",
        boneDensity: "Kritische Knochendichte-Unterstützung: D3, K2 und Magnesium",
        agingDecline: "Anti-Aging-Unterstützung für Gehirn und zelluläre Energie",
        restrictiveDiet: "Füllt wesentliche Nährstofflücken durch restriktive Ernährung",
        pregnancy: "Unterstützt die Gesundheit von Mutter und Kind während der Schwangerschaft",
        postSurgery: "Unterstützt Gewebeheilung und Erholung nach Operationen",
        poorNutrition: "Behebt häufige Mängel durch einseitige Ernährung",
        muscleBuilding: "Kreatin ist das am besten belegte Präparat für den Muskelaufbau",
        weightGoal: "Unterstützt Sättigungsgefühl und Blutzucker beim Gewichtsmanagement",
        gymPerformance: "Unterstützt Trainingsleistung, Ausdauer und Erholung",
        attention: "Omega-3 und L-Theanin verbessern Aufmerksamkeit und Konzentration",
        poorAppetite: "Zinkmangel ist eine häufige und behebbare Ursache von Appetitlosigkeit",
        sugarCravings: "Berberin und Ballaststoffe regulieren den Blutzucker und reduzieren Heißhunger",
        poorSatiety: "Ballaststoffe und Berberin verbessern das Sättigungssignal",
      },
    },
    doseAdjustments: {
      vitaminD3LowSun:
        "Mit 4.000 IE/Tag beginnen (höhere Dosis aufgrund minimaler Sonnenexposition)",
      b12Vegan: "2.500 mcg/Tag (höhere Dosis als einzige Quelle)",
      magnesiumHeavy: "400–500 mg/Tag (erhöht aufgrund intensiven Trainings)",
      electrolytesKeto: "2–3 Portionen/Tag während der Keto-Adaptation",
    },
    timingSlots: {
      morning: "Morgens (zum Frühstück)",
      midMorning: "Vormittags",
      lunch: "Mittagessen",
      evening: "Abends (vor dem Schlafen)",
      anytime: "Jederzeit (Regelmäßigkeit ist entscheidend)",
    },
    timingNotes: {
      iron: "Mit Vitamin C einnehmen, Abstand zu Kaffee halten",
      fiber: "Mit einem großen Glas Wasser",
      takeWithFood: "Mit dem Essen einnehmen",
    },
    summary: (count, primary, secondary, essentialCount, totalWarnings) =>
      `Basierend auf deinem Profil habe ich einen Plan mit ${count} Präparat${count !== 1 ? 'en' : ''} entwickelt, der auf ${primary}${
        secondary ? ` und ${secondary}` : ""
      } abzielt. ${essentialCount} Präparat${essentialCount !== 1 ? 'e sind essenziell' : ' ist essenziell'} für deine spezifische Situation${
        totalWarnings > 0
          ? `, und ich habe ${totalWarnings} Wechselwirkung${totalWarnings !== 1 ? 'en' : ''} zur Beachtung markiert`
          : ""
      }.`,
    disclaimers: {
      base: [
        "Dieser Quiz dient der Aufklärung und ersetzt keine professionelle medizinische Beratung.",
        "Konsultiere deinen Arzt oder Apotheker, bevor du mit einer Nahrungsergänzung beginnst.",
      ],
      removedSupplements: (count, names) =>
        `${count} Präparat${count !== 1 ? 'e wurden' : ' wurde'} aufgrund von Wechselwirkungen mit deinen Medikamenten ausgeschlossen: ${names}.`,
      bloodThinners:
        "Du nimmst Blutverdünner. Jedes neue Nahrungsergänzungsmittel muss mit deinem Apotheker oder Arzt abgeklärt werden.",
    },
  },

  questions: {
    age: {
      section: "Über dich",
      question: "In welcher Altersgruppe bist du?",
      options: {
        "20-30": { label: "20–30" },
        "30-40": { label: "30–40" },
        "40-50": { label: "40–50" },
        "50-60": { label: "50–60" },
      },
    },
    sex: {
      section: "Über dich",
      question: "Was ist dein biologisches Geschlecht?",
      subtitle: "Das beeinflusst den Nährstoffbedarf und Dosierungsempfehlungen.",
      options: {
        male: { label: "Männlich" },
        female: { label: "Weiblich" },
      },
    },
    menopause: {
      section: "Über dich",
      question: "Bist du in den Wechseljahren?",
      options: {
        post: { label: "Ja (in den Wechseljahren)" },
        pre: { label: "Nein (nicht in den Wechseljahren)" },
        unsure: { label: "Im Übergang zu den Wechseljahren (Perimenopause)" },
      },
    },
    medications: {
      section: "Über dich",
      question: "Nimmst du derzeit Medikamente ein?",
      subtitle:
        "Das ist entscheidend für die Prüfung auf Wechselwirkungen zwischen Ergänzungsmitteln und Arzneimitteln. Wähle alles Zutreffende aus.",
      options: {
        statins: { label: "Statine (Cholesterin)" },
        metformin: { label: "Metformin (Diabetes)" },
        "blood-thinners": { label: "Blutverdünner (Warfarin usw.)" },
        thyroid: { label: "Schilddrüsenmedikament" },
        ssri: { label: "Antidepressiva (SSRI)" },
        ppi: { label: "Magensäure / Protonenpumpenhemmer" },
        "bp-meds": { label: "Blutdruckmittel" },
        "birth-control": { label: "Verhütungsmittel" },
        antihistamines: { label: "Antihistaminika (Cetirizin, Loratadin)" },
        corticosteroids: { label: "Kortikosteroide (Prednison)" },
        "osteoporosis-meds": { label: "Osteoporose-Medikamente (Bisphosphonate)" },
        "sleep-aids": { label: "Schlafmittel (Zolpidem, Benzodiazepine)" },
        antibiotics: { label: "Antibiotika (laufende Kur)" },
        antifungals: { label: "Antimykotika" },
        immunosuppressants: { label: "Immunsuppressiva" },
        "seizure-meds": { label: "Epilepsiemittel (Antikonvulsiva)" },
        hrt: { label: "Hormonersatztherapie (HRT)" },
        "anti-asthmatic": { label: "Antiasthmatika (Inhalatoren, Montelukast)" },
        "anti-neoplastic": { label: "Zytostatika (Chemotherapie)" },
        none: { label: "Keine" },
      },
    },
    diet: {
      section: "Dein Lebensstil",
      question: "Wie würdest du deine Ernährung beschreiben?",
      options: {
        omnivore: { label: "Omnivor", description: "Ich esse alles" },
        vegetarian: {
          label: "Vegetarisch",
          description: "Kein Fleisch, aber Eier und Milchprodukte",
        },
        vegan: { label: "Vegan", description: "Rein pflanzlich" },
        keto: {
          label: "Keto / Low-Carb",
          description: "Fettreich, kohlenhydratarm",
        },
        mediterranean: {
          label: "Mediterran",
          description: "Vollwertkost, Olivenöl, Fisch",
        },
        "no-specific": {
          label: "Keine bestimmte Ernährungsweise",
          description: "Ich esse, was ich finde",
        },
      },
    },
    exercise: {
      section: "Dein Lebensstil",
      question: "Wie oft treibst du Sport?",
      options: {
        rarely: { label: "Selten", description: "Weniger als einmal pro Woche" },
        light: { label: "1–2× pro Woche", description: "Leichte Aktivität" },
        moderate: { label: "3–4× pro Woche", description: "Regelmäßiges Training" },
        heavy: { label: "5+ Tage pro Woche", description: "Intensives Training" },
      },
    },
    stress: {
      section: "Dein Lebensstil",
      question: "Wie würdest du deinen Stresspegel einschätzen?",
      options: {
        low: { label: "Niedrig (1–3)", description: "Grundsätzlich entspannt" },
        moderate: {
          label: "Mittel (4–6)",
          description: "Normaler Alltagsstress",
        },
        high: {
          label: "Hoch (7–10)",
          description: "Oft überfordert",
        },
      },
    },
    sleep: {
      section: "Dein Lebensstil",
      question: "Wie ist deine Schlafqualität?",
      options: {
        great: {
          label: "Gut",
          description: "Schlafe schnell ein und durch",
        },
        okay: { label: "In Ordnung", description: "Gelegentliche Probleme" },
        poor: {
          label: "Schlecht",
          description: "Regelmäßige Schwierigkeiten beim Ein- oder Durchschlafen",
        },
      },
    },
    sun: {
      section: "Dein Lebensstil",
      question: "Wie viel Sonnenlicht bekommst du täglich?",
      options: {
        lots: { label: "Viel", description: "Arbeit oder Alltag im Freien" },
        some: { label: "Etwas", description: "30+ Minuten pro Tag" },
        minimal: { label: "Kaum", description: "Überwiegend drinnen" },
      },
    },
    "primary-goal": {
      section: "Deine Ziele",
      question: "Was ist dein primäres Gesundheitsziel?",
      subtitle: "Wähle das aus, das dir im Moment am wichtigsten ist.",
      options: {
        energy: { label: "Energie & Vitalität" },
        sleep: { label: "Besserer Schlaf" },
        immunity: { label: "Immununterstützung" },
        joints: { label: "Gelenkgesundheit & Beweglichkeit" },
        stress: { label: "Stress & Angst" },
        cognitive: { label: "Gehirn & Fokus" },
        athletic: { label: "Sportliche Leistung" },
        gut: { label: "Darmgesundheit & Verdauung" },
        heart: { label: "Herzgesundheit" },
        skin: { label: "Haut, Haare & Nägel" },
        weight: { label: "Gewichtsmanagement" },
        longevity: { label: "Langlebigkeit & Anti-Aging" },
      },
    },
    "secondary-goal": {
      section: "Deine Ziele",
      question: "Hast du ein sekundäres Gesundheitsziel?",
      options: {
        energy: { label: "Energie & Vitalität" },
        sleep: { label: "Besserer Schlaf" },
        immunity: { label: "Immununterstützung" },
        joints: { label: "Gelenkgesundheit" },
        stress: { label: "Stress & Angst" },
        cognitive: { label: "Gehirn & Fokus" },
        athletic: { label: "Sportliche Leistung" },
        gut: { label: "Darmgesundheit" },
        heart: { label: "Herzgesundheit" },
        skin: { label: "Haut, Haare & Nägel" },
        weight: { label: "Gewichtsmanagement" },
        longevity: { label: "Langlebigkeit" },
        none: { label: "Kein sekundäres Ziel" },
      },
    },
    complaints: {
      section: "Deine Beschwerden",
      question: "Was sind deine aktuellen Beschwerden oder Anliegen?",
      subtitle: "Wähle alles Zutreffende aus — das ermöglicht es, deinen Plan auf deine tatsächlichen Symptome abzustimmen.",
      options: {
        "chronic-fatigue": { label: "Chronische Müdigkeit / ständig erschöpft", group: "Energie & Erschöpfung" },
        "afternoon-crash": { label: "Nachmittäglicher Energieeinbruch", group: "Energie & Erschöpfung" },
        "unrefreshed-sleep": { label: "Unerholt aufwachen / nicht ausgeruht", group: "Energie & Erschöpfung" },
        "brain-fog": { label: "Gehirnnebel, schlechte Konzentration, Vergesslichkeit", group: "Energie & Erschöpfung" },
        "anxiety": { label: "Angst oder Sorgen", group: "Stimmung, Stress & Schlaf" },
        "low-mood": { label: "Gedrückte Stimmung / Traurigkeit", group: "Stimmung, Stress & Schlaf" },
        "irritability": { label: "Reizbarkeit / Stimmungsschwankungen", group: "Stimmung, Stress & Schlaf" },
        "stress-overwhelm": { label: "Schwierigkeiten beim Umgang mit Stress", group: "Stimmung, Stress & Schlaf" },
        "trouble-falling-asleep": { label: "Einschlafprobleme", group: "Stimmung, Stress & Schlaf" },
        "waking-at-night": { label: "Nächtliches Aufwachen / unruhiger Schlaf", group: "Stimmung, Stress & Schlaf" },
        "brittle-nails": { label: "Brüchige oder schwache Nägel", group: "Haare, Haut & Nägel" },
        "hair-loss": { label: "Haarausfall oder -ausdünnung", group: "Haare, Haut & Nägel" },
        "dry-skin": { label: "Trockene oder schuppige Haut", group: "Haare, Haut & Nägel" },
        "slow-healing": { label: "Langsame Wundheilung", group: "Haare, Haut & Nägel" },
        "premature-graying": { label: "Frühzeitiges Ergrauen", group: "Haare, Haut & Nägel" },
        "muscle-cramps": { label: "Muskelkrämpfe oder -zuckungen", group: "Muskeln, Gelenke & Erholung" },
        "joint-stiffness": { label: "Gelenksteifheit oder -schmerzen", group: "Muskeln, Gelenke & Erholung" },
        "general-weakness": { label: "Allgemeine Muskelschwäche", group: "Muskeln, Gelenke & Erholung" },
        "slow-recovery": { label: "Langsame Erholung nach dem Sport", group: "Muskeln, Gelenke & Erholung" },
        "frequent-illness": { label: "Häufige Erkältungen, Infektionen oder langsame Heilung", group: "Immunität" },
        "seasonal-allergies": { label: "Verschlechterung saisonaler Allergien", group: "Immunität" },
        "bloating-gas": { label: "Blähungen oder Völlegefühl", group: "Verdauung & Darm" },
        "indigestion": { label: "Verdauungsstörungen / Sodbrennen", group: "Verdauung & Darm" },
        "constipation": { label: "Verstopfung", group: "Verdauung & Darm" },
        "food-sensitivities": { label: "Nahrungsmittelunverträglichkeiten oder Beschwerden nach dem Essen", group: "Verdauung & Darm" },
        "bone-density-concern": { label: "Sorgen um Knochendichte oder Osteoporose", group: "Knochengesundheit & Altern" },
        "age-related-decline": { label: "Altersbedingte Gedächtnis-, Energie- oder Sehverschlechterung", group: "Knochengesundheit & Altern" },
        "restrictive-diet": { label: "Vegane oder sehr restriktive Ernährung", group: "Ernährungslücken & Lebensphasen" },
        "pregnancy-planning": { label: "Schwanger oder Kinderwunsch", group: "Ernährungslücken & Lebensphasen" },
        "post-surgery": { label: "Erholung nach Operation oder Verletzung", group: "Ernährungslücken & Lebensphasen" },
        "poor-nutrition": { label: "Einseitige Ernährung oder ausgelassene Mahlzeiten", group: "Ernährungslücken & Lebensphasen" },
        "muscle-building": { label: "Muskelaufbau", group: "Fitness & Körperziele" },
        "weight-management-goal": { label: "Gewichtsmanagement oder Fettabbau", group: "Fitness & Körperziele" },
        "gym-performance": { label: "Sportliche Leistung oder Ausdauer", group: "Fitness & Körperziele" },
        "attention-focus": { label: "Konzentrationsprobleme, leichte Ablenkbarkeit, Schwierigkeiten beim Fertigstellen von Aufgaben", group: "Aufmerksamkeit & Fokus" },
        "poor-appetite": { label: "Appetitlosigkeit oder zu wenig essen", group: "Appetit" },
        "sugar-cravings": { label: "Heißhunger auf Süßes oder Überessen", group: "Appetit" },
        "poor-satiety": { label: "Geringes Sättigungsgefühl nach den Mahlzeiten", group: "Appetit" },
        none: { label: "Keine Beschwerden" },
      },
    },
    allergies: {
      section: "Präferenzen",
      question: "Hast du Allergien oder Unverträglichkeiten?",
      subtitle:
        "Wähle alles Zutreffende aus. Das filtert ungeeignete Produktempfehlungen heraus.",
      options: {
        shellfish: { label: "Schalentiere" },
        soy: { label: "Soja" },
        gluten: { label: "Gluten" },
        fish: { label: "Fisch" },
        dairy: { label: "Milchprodukte" },
        none: { label: "Keine" },
      },
    },
    form: {
      section: "Präferenzen",
      question: "Welche Form von Nahrungsergänzungsmitteln bevorzugst du?",
      options: {
        capsules: { label: "Kapseln / Tabletten" },
        gummies: { label: "Gummibärchen" },
        powder: { label: "Pulver" },
        liquid: { label: "Flüssig" },
        "no-preference": { label: "Keine Präferenz" },
      },
    },
    currency: {
      section: "Präferenzen",
      question: "Welche Währung bevorzugst du?",
      options: {
        usd: { label: "USD ($)" },
        eur: { label: "EUR (€)" },
        gbp: { label: "GBP (£)" },
        try: { label: "TRY (₺)" },
      },
    },
    budget: {
      section: "Präferenzen",
      question: "Was ist dein monatliches Budget für Nahrungsergänzungsmittel?",
      options: {
        starter: {
          label: "Einsteiger",
          description: "$15–25 / €14–23 / £12–20 / ₺510–850",
        },
        budget: {
          label: "Sparsam",
          description: "$25–50 / €23–46 / £20–40 / ₺850–1.700",
        },
        mid: {
          label: "Mittleres Segment",
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
      section: "Bleib auf dem Laufenden",
      question: "Möchtest du monatliche, von Apothekern geprüfte Tipps zu Nahrungsergänzungsmitteln erhalten?",
      subtitle:
        "Abonniere unseren kostenlosen Newsletter — neue Forschungsergebnisse, Mythen-Checks und Produkthinweise.",
      options: {
        yes: { label: "Ja, anmelden!" },
        no: { label: "Nein danke, zeig mir einfach meine Ergebnisse" },
      },
    },
  },

  supplements: {
    "vitamin-d3": {
      category: "Vitamin",
      primaryBenefit: "Knochengesundheit & Immunität",
      pharmacistNote:
        "Mit K2 (MK-7) kombinieren für korrektes Kalziumrouting. Wenn möglich, vorher den Blutspiegel messen lassen. Zielwert: 40–60 ng/mL.",
    },
    magnesium: {
      category: "Mineral",
      primaryBenefit: "Schlaf & Muskelentspannung",
      pharmacistNote:
        "Oxidform hat schlechte Bioverfügbarkeit (~4 %). Glycinat ist der Goldstandard. Die meisten Erwachsenen haben einen Magnesiummangel.",
    },
    "omega-3": {
      category: "Essentielle Fettsäure",
      primaryBenefit: "Herzgesundheit & Entzündungshemmung",
      pharmacistNote:
        "Auf IFOS-Zertifizierung achten. Kein Fischgeschmack bedeutet magensaftresistente Kapsel. Algenbasiert für Veganer.",
    },
    probiotics: {
      category: "Darmgesundheit",
      primaryBenefit: "Verdauungsgesundheit",
      pharmacistNote:
        "Stammspezifität ist entscheidend: L. rhamnosus GG (Darm), B. longum (Stimmung). Kühlpflichtige Produkte in der Regel besser als Regalware.",
    },
    "vitamin-b12": {
      category: "Vitamin",
      primaryBenefit: "Energie & Nervenfunktion",
      pharmacistNote:
        "Kritisch für Veganer und Vegetarier. Metformin erschöpft B12. Sublingualform umgeht Absorptionsprobleme im Darm.",
    },
    zinc: {
      category: "Mineral",
      primaryBenefit: "Immunität & Hautgesundheit",
      pharmacistNote:
        "MUSS mit Kupfer ausgeglichen werden (2 mg Cu je 15 mg Zn). Nicht zusammen mit Eisen oder Kalzium einnehmen — sie konkurrieren um die Aufnahme.",
    },
    ashwagandha: {
      category: "Adaptogen",
      primaryBenefit: "Stressreduktion",
      pharmacistNote:
        "Nicht zusammen mit Schilddrüsenmedikamenten einnehmen (kann Schilddrüsenhormone erhöhen). Gehört zur Nachtschattenfamilie. Einnahmezyklus: 8 Wochen nehmen, 2 Wochen Pause.",
    },
    curcumin: {
      category: "Entzündungshemmend",
      primaryBenefit: "Gelenkschmerzen & Entzündung",
      pharmacistNote:
        "Piperin erhöht die Absorption um 2.000 %. Einfache Kurkumakapseln sind therapeutisch nahezu wirkungslos.",
    },
    collagen: {
      category: "Protein",
      primaryBenefit: "Haut & Gelenkunterstützung",
      pharmacistNote:
        "Unbedingt mit Vitamin C kombinieren — für die Kollagensynthese unerlässlich. Meereskollagen > Rinderkollagen für die Haut. Ergebnisse nach 8–12 Wochen.",
    },
    creatine: {
      category: "Leistung",
      primaryBenefit: "Muskelkraft & Power",
      pharmacistNote:
        "Das am meisten erforschte Nahrungsergänzungsmittel der Geschichte. Kein Cycling notwendig. Keine Ladephase nötig. Kann anfangs zu leichter Wassereinlagerung führen.",
    },
    "vitamin-c": {
      category: "Vitamin",
      primaryBenefit: "Immunität & Antioxidans",
      pharmacistNote:
        "Megadosierung (5 g+) verursacht Magen-Darm-Beschwerden. Zusammen mit eisenreichen Lebensmitteln einnehmen, um die Eisenaufnahme zu verbessern. Raucher brauchen täglich 35 mg mehr.",
    },
    iron: {
      category: "Mineral",
      primaryBenefit: "Energie & Blutgesundheit",
      pharmacistNote:
        "NICHT supplementieren ohne bestätigten Mangel (Bluttest). Nie zusammen mit Kalzium, Zink oder Kaffee einnehmen. Schilddrüsenmedikamente mindestens 4 Stunden zeitversetzt einnehmen.",
    },
    "l-theanine": {
      category: "Aminosäure",
      primaryBenefit: "Ruhige Konzentration & Angstlinderung",
      pharmacistNote:
        "200 mg L-Theanin + 100 mg Koffein = der nootropische Sweet Spot. Kein Schläfrigkeitsgefühl. Verträglich mit den meisten Medikamenten.",
    },
    "vitamin-k2": {
      category: "Vitamin",
      primaryBenefit: "Knochen- & Herz-Kreislauf-Gesundheit",
      pharmacistNote:
        "KRITISCH bei Vitamin-D-Einnahme — D erhöht die Kalziumaufnahme, K2 bestimmt den Zielort. KONTRAINDIZIERT mit Warfarin.",
    },
    coq10: {
      category: "Antioxidans",
      primaryBenefit: "Herzgesundheit & Zelluläre Energie",
      pharmacistNote:
        "UNERLÄSSLICH für alle, die Statine nehmen — Statine erschöpfen CoQ10 und verursachen Muskelschmerzen. Ubiquinol-Form bevorzugt ab 40 Jahren.",
    },
    melatonin: {
      category: "Hormon",
      primaryBenefit: "Einschlafen",
      pharmacistNote:
        "Weniger ist mehr — 0,5 mg wirkt oft besser als 5 mg. Nicht für den langfristigen täglichen Gebrauch ohne ärztliche Begleitung empfohlen. Kann bei manchen Depressionen verschlimmern.",
    },
    nac: {
      category: "Aminosäure",
      primaryBenefit: "Leberunterstützung & Entgiftung",
      pharmacistNote:
        "Bewährte Wirksamkeit bei Paracetamol-Vergiftung. Wachsende Belege für Zwangsstörungen/Trichotillomanie. Mit Vitamin C einnehmen, um Oxidation zu verhindern.",
    },
    berberine: {
      category: "Botanisch",
      primaryBenefit: "Blutzuckerregulierung",
      pharmacistNote:
        "STARKE Arzneimittelwechselwirkungen — ahmt den Mechanismus von Metformin nach. Nicht ohne ärztliche Aufsicht mit Metformin kombinieren. Kann den Blutdruck senken.",
    },
    electrolytes: {
      category: "Mineralkomplex",
      primaryBenefit: "Hydratation & Leistung",
      pharmacistNote:
        "Unverzichtbar beim Fasten, bei Keto und starkem Schwitzen. Die meisten handelsüblichen Sportgetränke enthalten zu viel Zucker und zu wenig Natrium.",
    },
    "fiber-psyllium": {
      category: "Verdauung",
      primaryBenefit: "Darmregelmäßigkeit & Cholesterin",
      pharmacistNote:
        "Mit niedriger Dosis (3 g) beginnen und langsam steigern, um Blähungen zu vermeiden. UNBEDINGT ausreichend Wasser trinken. Mindestens 2 Stunden Abstand zu Medikamenten halten.",
    },
  },
}
