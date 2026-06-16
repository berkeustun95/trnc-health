import type { QuizTranslations } from './translations'

export const fr: QuizTranslations = {
  ui: {
    awaiting: {
      title: 'En attente de révision',
      subtitle: (name) => `${name} examine vos résultats de compléments alimentaires.`,
      timerLabel: 'RÉVISION SE TERMINE DANS',
      infoText: 'Un pharmacien agréé vérifie vos réponses et peut ajuster votre programme de compléments avant que vous ne voyiez les résultats finaux.',
      cancelBtn: 'Choisir un autre pharmacien',
    },
    landing: {
      badge: "Quiz conçu par un pharmacien",
      titleLine1: "Quels compléments alimentaires",
      titleLine2: "vous faut-il vraiment ?",
      subtitle:
        "Arrêtez de deviner. Un pharmacien agréé a créé ce quiz pour démêler le vrai du faux — obtenez un programme de compléments personnalisé selon vos objectifs de santé, vos médicaments et votre mode de vie. Avec un contrôle des interactions médicamenteuses qu'aucun influenceur ne peut offrir.",
      cta: "Faire le quiz gratuit →",
      minutes: "3 minutes",
      questions: "16 questions",
      free: "100 % gratuit",
      trustPharmacist: "Conçu par un pharmacien agréé",
      trustInteraction: "Dépistage des interactions médicamenteuses",
      trustEvidence: "Recommandations fondées sur des preuves",
      whatYouGetTitle: "Ce que vous obtiendrez",
      feature1Title: "Programme personnalisé",
      feature1Desc:
        "Des compléments choisis spécifiquement pour votre âge, vos objectifs, votre alimentation et votre mode de vie — pas des conseils génériques.",
      feature2Title: "Contrôle de sécurité",
      feature2Desc:
        "Votre programme est croisé avec vos médicaments pour détecter les interactions dangereuses. Aucun influenceur ne fait cela.",
      feature3Title: "Calendrier de prise",
      feature3Desc:
        "Exactement quand prendre chaque complément et pourquoi — car le moment de la prise influence l'absorption jusqu'à 75 %.",
      readyCTA: "Prêt à découvrir ce dont vous avez vraiment besoin ?",
      startCTA: "Commencer le quiz →",
    },
    quiz: {
      back: "← Retour",
      continue: "Continuer →",
      skip: "Passer →",
      selectAll: "Sélectionner tout ce qui s'applique",
      of: "sur",
      other: "Autre",
      otherPlaceholder: "Tapez et appuyez sur Entrée...",
    },
    results: {
      badge: "Vos résultats personnalisés",
      title: "Votre programme de compléments",
      recommendedTitle: "Vos compléments recommandés",
      interactionTitle: "Alertes d'interactions",
      scheduleTitle: "Votre calendrier quotidien de prise",
      scheduleNote:
        "Le moment de la prise influence l'absorption jusqu'à 75 %. Respectez ce calendrier pour une efficacité maximale.",
      notesTitle: "Notes importantes",
      retake: "← Refaire le quiz",
      share: "Partager vos résultats 📤",
      shareText:
        "Je viens de recevoir mon programme de compléments personnalisé grâce à un quiz conçu par un pharmacien !",
      linkCopied: "Lien copié dans le presse-papiers !",
      downloadPdf: "Télécharger le PDF ↓",
      priority: {
        essential: "Essentiel",
        recommended: "Recommandé",
        optional: "Optionnel",
      },
      bestForm: "Meilleure forme",
      dose: "Dose",
      timing: "Moment de prise",
      withFood: "Avec les repas",
      withFoodYes: "Oui ✓",
      withFoodNo: "Non — à jeun",
      withFoodOptional: "Optionnel",
      pharmacistTip: "💡 Conseil du pharmacien :",
      viewProduct: "Acheter ce produit →",
      evidenceLabel: "Preuve",
      perMonth: "/mois",
      back: "← Retour",
      backToApp: "← Retour à l'appli",
    },
    loading: {
      title: "Conception de votre programme",
      subtitle: "Votre pharmacien examine vos réponses...",
      steps: [
        { emoji: "🔍", text: "Analyse de votre profil..." },
        { emoji: "💊", text: "Association des compléments à vos objectifs..." },
        { emoji: "⚠️", text: "Dépistage des interactions médicamenteuses..." },
        { emoji: "⏰", text: "Élaboration de votre calendrier de prise..." },
        { emoji: "✅", text: "Finalisation de votre programme..." },
      ],
    },
  },

  engine: {
    goalLabels: {
      energy: "Énergie & Vitalité",
      sleep: "Meilleur sommeil",
      immunity: "Soutien immunitaire",
      joints: "Santé articulaire",
      stress: "Gestion du stress & de l'anxiété",
      cognitive: "Cerveau & Concentration",
      athletic: "Performance sportive",
      gut: "Santé intestinale",
      heart: "Santé cardiovasculaire",
      skin: "Peau, cheveux & ongles",
      weight: "Gestion du poids",
      longevity: "Longévité & Anti-âge",
    },
    coreReason: (g) => `Complément essentiel pour ${g}`,
    supportsReason: (g) => `Soutient ${g}`,
    additionalReason: (g) => `Soutien complémentaire pour ${g}`,
    secondaryKeyReason: (g) => `Essentiel pour l'objectif secondaire : ${g}`,
    secondarySupportsReason: (g) => `Soutient ${g}`,
    reasons: {
      veganB12: "Indispensable pour les véganes — les aliments végétaux ne contiennent pas de B12",
      veganIron: "Les véganes présentent un risque plus élevé de carence en fer",
      veganOmega3:
        "Choisir une source algale — acides gras essentiels absents des régimes véganes",
      vegetarianB12: "Les végétariens ont souvent des niveaux de B12 insuffisants",
      ketoElectrolytes:
        "Le régime keto épuise rapidement les électrolytes — la « grippe keto » est généralement une carence en électrolytes",
      ketoMagnesium: "Le régime keto augmente les pertes de magnésium",
      minimalSunD3:
        "Principalement en intérieur = carence en vitamine D quasi certaine. Le complément à impact individuel le plus élevé.",
      highStressAshwagandha:
        "Un stress élevé épuise plus rapidement le magnésium et les vitamines B",
      highStressMagnesium: "Le stress accélère la consommation de magnésium",
      poorSleepMagnesium:
        "Mauvais sommeil — le glycinate de magnésium active le GABA pour favoriser la relaxation",
      poorSleepTheanine:
        "Favorise les ondes cérébrales alpha pour un endormissement plus facile",
      heavyCreatine:
        "Entraînement intensif — la créatine soutient la puissance musculaire et la récupération",
      heavyElectrolytes: "La transpiration abondante épuise significativement les minéraux",
      femalePre:
        "Les femmes préménopausées ont des besoins en fer plus élevés en raison des menstruations",
      femalePostD3: "Protection de la densité osseuse après la ménopause",
      femalePostK2: "Oriente le calcium vers les os (essentiel après la ménopause)",
      statinsCoq10:
        "Les statines épuisent la CoQ10 — première cause de douleurs musculaires liées aux statines. C'est le complément indispensable à votre statine.",
      metforminB12:
        "La metformine appauvrit en B12 avec le temps — c'est prouvé. Faites vérifier vos taux annuellement.",
      coq10AgeSuffix:
        " Utiliser la forme Ubiquinol — la capacité de conversion diminue après 40 ans.",
      algaeAllergySuffix:
        " (Choisir une source ALGALE — pas d'huile de poisson en raison de votre allergie)",
      sym: {
        fatigue: "Cible directement votre fatigue chronique et votre manque d'énergie",
        afternoonCrash: "Soutient une énergie stable pour éviter les coups de pompe de l'après-midi",
        unrefreshedSleep: "Améliore la profondeur du sommeil et le réveil reposé",
        brainFog: "Cible directement le brouillard mental, la concentration et la mémoire",
        anxiety: "Validé cliniquement pour l'anxiété et la réponse au stress",
        lowMood: "Soutient l'équilibre des neurotransmetteurs pour l'humeur",
        irritability: "L'irritabilité épuise plus rapidement le magnésium et les vitamines B",
        stressOverwhelm: "Soutien adaptogène pour la résistance au stress",
        sleepOnset: "Soutient l'activation du GABA et l'endormissement",
        sleepQuality: "Soutient la continuité du sommeil et le sommeil profond",
        brittleNails: "Le zinc et le collagène sont des nutriments structurels essentiels pour les ongles",
        hairLoss: "Cible le zinc, le collagène et le fer comme causes fréquentes de chute de cheveux",
        drySkin: "Les oméga-3 et le collagène soutiennent la barrière cutanée et l'hydratation",
        slowHealing: "La vitamine C et le zinc sont essentiels à la réparation tissulaire",
        graying: "Une carence en B12 est associée au grisonnement prématuré",
        cramps: "La carence en magnésium et en électrolytes est la cause la plus fréquente des crampes",
        jointPain: "Les oméga-3 et la curcumine réduisent l'inflammation et la raideur articulaire",
        weakness: "Les carences en B12 et en fer sont des causes fréquentes de faiblesse générale",
        slowRecovery: "Soutient la récupération post-exercice et la réparation musculaire",
        frequentIllness: "Soutien immunitaire de base : vitamine D, zinc et vitamine C",
        allergies: "Module la surréaction immunitaire et la sévérité des allergies saisonnières",
        bloating: "Les probiotiques et les fibres rétablissent l'équilibre intestinal et réduisent les ballonnements",
        indigestion: "Soutien probiotique pour l'équilibre des enzymes digestives",
        constipation: "Les fibres de psyllium et le magnésium favorisent la régularité intestinale",
        foodSens: "Microbiome intestinal et intégrité de la barrière pour les sensibilités alimentaires",
        boneDensity: "Soutien critique de la densité osseuse : D3, K2 et magnésium",
        agingDecline: "Soutien anti-âge pour le cerveau et l'énergie cellulaire",
        restrictiveDiet: "Comble les lacunes nutritionnelles clés liées à une alimentation restrictive",
        pregnancy: "Soutient la santé maternelle et fœtale pendant la grossesse",
        postSurgery: "Soutient la cicatrisation et la récupération post-opératoire",
        poorNutrition: "Corrige les carences courantes liées à une alimentation peu variée",
        muscleBuilding: "La créatine est le complément le mieux étayé scientifiquement pour la prise de masse",
        weightGoal: "Soutient la satiété et la glycémie pour la gestion du poids",
        gymPerformance: "Soutient la performance sportive, l'endurance et la récupération",
        attention: "Les oméga-3 et la L-théanine améliorent l'attention et la concentration",
        poorAppetite: "La carence en zinc est une cause fréquente et réversible du manque d'appétit",
        sugarCravings: "La berbérine et les fibres régulent la glycémie et réduisent les envies de sucre",
        poorSatiety: "Les fibres et la berbérine améliorent le signal de satiété",
      },
    },
    doseAdjustments: {
      vitaminD3LowSun:
        "Commencer à 4 000 UI/jour (dose plus élevée en raison d'une exposition minimale au soleil)",
      b12Vegan: "2 500 mcg/jour (dose plus élevée car seule source)",
      magnesiumHeavy: "400–500 mg/jour (augmenté en raison d'un entraînement intensif)",
      electrolytesKeto: "2 à 3 portions/jour pendant l'adaptation au régime keto",
    },
    timingSlots: {
      morning: "Matin (avec le petit-déjeuner)",
      midMorning: "Milieu de matinée",
      lunch: "Déjeuner",
      evening: "Soir (avant de dormir)",
      anytime: "N'importe quand (la régularité est essentielle)",
    },
    timingNotes: {
      iron: "Prendre avec de la vitamine C, à distance du café",
      fiber: "Avec un grand verre d'eau",
      takeWithFood: "Prendre avec les repas",
    },
    summary: (count, primary, secondary, essentialCount, totalWarnings) =>
      `D'après votre profil, j'ai conçu un programme de ${count} complément${count > 1 ? 's' : ''} ciblant ${primary}${
        secondary ? ` et ${secondary}` : ""
      }. ${essentialCount} complément${essentialCount > 1 ? 's sont essentiels' : ' est essentiel'} pour votre situation${
        totalWarnings > 0
          ? `, et j'ai signalé ${totalWarnings} interaction${totalWarnings > 1 ? 's' : ''} à surveiller`
          : ""
      }.`,
    disclaimers: {
      base: [
        "Ce quiz fournit des conseils éducatifs et ne remplace pas un avis médical professionnel.",
        "Consultez votre professionnel de santé avant de commencer tout programme de compléments alimentaires.",
      ],
      removedSupplements: (count, names) =>
        `${count} complément${count > 1 ? 's ont été exclus' : ' a été exclu'} en raison d'interactions avec vos médicaments : ${names}.`,
      bloodThinners:
        "Vous prenez des anticoagulants. Tout nouveau complément doit être validé par votre pharmacien ou votre médecin.",
    },
  },

  questions: {
    age: {
      section: "À votre sujet",
      question: "Quelle est votre tranche d'âge ?",
      options: {
        "20-30": { label: "20–30" },
        "30-40": { label: "30–40" },
        "40-50": { label: "40–50" },
        "50-60": { label: "50–60" },
      },
    },
    sex: {
      section: "À votre sujet",
      question: "Quel est votre sexe biologique ?",
      subtitle: "Cela influence les besoins nutritionnels et les recommandations de dosage.",
      options: {
        male: { label: "Homme" },
        female: { label: "Femme" },
      },
    },
    menopause: {
      section: "À votre sujet",
      question: "Êtes-vous en ménopause ?",
      options: {
        post: { label: "Oui (en ménopause)" },
        pre: { label: "Non (pas en ménopause)" },
        unsure: { label: "En transition vers la ménopause (péri-ménopause)" },
      },
    },
    medications: {
      section: "À votre sujet",
      question: "Prenez-vous actuellement des médicaments ?",
      subtitle:
        "Cette information est indispensable pour vérifier les interactions médicaments-compléments. Sélectionnez tout ce qui s'applique.",
      options: {
        statins: { label: "Statines (cholestérol)" },
        metformin: { label: "Metformine (diabète)" },
        "blood-thinners": { label: "Anticoagulants (warfarine, etc.)" },
        thyroid: { label: "Médicament thyroïdien" },
        ssri: { label: "Antidépresseurs (ISRS)" },
        ppi: { label: "Reflux gastrique / IPP" },
        "bp-meds": { label: "Médicament antihypertenseur" },
        "birth-control": { label: "Contraceptif" },
        antihistamines: { label: "Antihistaminiques (cétirizine, loratadine)" },
        corticosteroids: { label: "Corticostéroïdes (prednisone)" },
        "osteoporosis-meds": { label: "Médicaments contre l'ostéoporose (bisphosphonates)" },
        "sleep-aids": { label: "Somnifères (zolpidem, benzodiazépines)" },
        antibiotics: { label: "Antibiotiques (cure en cours)" },
        antifungals: { label: "Antifongiques" },
        immunosuppressants: { label: "Immunosuppresseurs" },
        "seizure-meds": { label: "Antiépileptiques (anticonvulsivants)" },
        hrt: { label: "Traitement hormonal substitutif (THS)" },
        "anti-asthmatic": { label: "Antiasthmatiques (inhalateurs, montélukast)" },
        "anti-neoplastic": { label: "Anticancéreux (chimiothérapie)" },
        none: { label: "Aucun" },
      },
    },
    diet: {
      section: "Votre mode de vie",
      question: "Comment décririez-vous votre alimentation ?",
      options: {
        omnivore: { label: "Omnivore", description: "Je mange de tout" },
        vegetarian: {
          label: "Végétarien",
          description: "Pas de viande, mais œufs/produits laitiers",
        },
        vegan: { label: "Végane", description: "100 % végétal" },
        keto: {
          label: "Keto / Faible en glucides",
          description: "Riche en graisses, pauvre en glucides",
        },
        mediterranean: {
          label: "Méditerranéen",
          description: "Aliments complets, huile d'olive, poisson",
        },
        "no-specific": {
          label: "Pas de régime particulier",
          description: "Je mange ce que je trouve",
        },
      },
    },
    exercise: {
      section: "Votre mode de vie",
      question: "À quelle fréquence faites-vous de l'exercice ?",
      options: {
        rarely: { label: "Rarement", description: "Moins d'une fois par semaine" },
        light: { label: "1–2× par semaine", description: "Activité légère" },
        moderate: { label: "3–4× par semaine", description: "Entraînements réguliers" },
        heavy: { label: "5 jours+ par semaine", description: "Entraînement intensif" },
      },
    },
    stress: {
      section: "Votre mode de vie",
      question: "Comment évalueriez-vous votre niveau de stress ?",
      options: {
        low: { label: "Faible (1–3)", description: "Généralement détendu" },
        moderate: {
          label: "Modéré (4–6)",
          description: "Stress normal du quotidien",
        },
        high: {
          label: "Élevé (7–10)",
          description: "Souvent débordé",
        },
      },
    },
    sleep: {
      section: "Votre mode de vie",
      question: "Comment est la qualité de votre sommeil ?",
      options: {
        great: {
          label: "Excellente",
          description: "Je m'endors facilement et reste endormi",
        },
        okay: { label: "Correcte", description: "Des problèmes occasionnels" },
        poor: {
          label: "Mauvaise",
          description: "Des difficultés régulières à m'endormir ou à rester endormi",
        },
      },
    },
    sun: {
      section: "Votre mode de vie",
      question: "Quelle est votre exposition quotidienne au soleil ?",
      options: {
        lots: { label: "Beaucoup", description: "Travail ou mode de vie en extérieur" },
        some: { label: "Un peu", description: "30 minutes ou plus par jour" },
        minimal: { label: "Minimale", description: "Principalement en intérieur" },
      },
    },
    "primary-goal": {
      section: "Vos objectifs",
      question: "Quel est votre objectif de santé principal ?",
      subtitle: "Choisissez celui qui vous tient le plus à cœur en ce moment.",
      options: {
        energy: { label: "Énergie & Vitalité" },
        sleep: { label: "Meilleur sommeil" },
        immunity: { label: "Soutien immunitaire" },
        joints: { label: "Santé articulaire & Mobilité" },
        stress: { label: "Stress & Anxiété" },
        cognitive: { label: "Cerveau & Concentration" },
        athletic: { label: "Performance sportive" },
        gut: { label: "Santé intestinale & Digestion" },
        heart: { label: "Santé cardiovasculaire" },
        skin: { label: "Peau, cheveux & Ongles" },
        weight: { label: "Gestion du poids" },
        longevity: { label: "Longévité & Anti-âge" },
      },
    },
    "secondary-goal": {
      section: "Vos objectifs",
      question: "Avez-vous un objectif de santé secondaire ?",
      options: {
        energy: { label: "Énergie & Vitalité" },
        sleep: { label: "Meilleur sommeil" },
        immunity: { label: "Soutien immunitaire" },
        joints: { label: "Santé articulaire" },
        stress: { label: "Stress & Anxiété" },
        cognitive: { label: "Cerveau & Concentration" },
        athletic: { label: "Performance sportive" },
        gut: { label: "Santé intestinale" },
        heart: { label: "Santé cardiovasculaire" },
        skin: { label: "Peau, cheveux & Ongles" },
        weight: { label: "Gestion du poids" },
        longevity: { label: "Longévité" },
        none: { label: "Pas d'objectif secondaire" },
      },
    },
    complaints: {
      section: "Vos plaintes",
      question: "Quelles sont vos plaintes ou préoccupations actuelles ?",
      subtitle: "Sélectionnez tout ce qui s'applique — cela permet d'adapter votre programme à vos symptômes réels.",
      options: {
        "chronic-fatigue": { label: "Fatigue chronique / toujours fatigué", group: "Énergie & Fatigue" },
        "afternoon-crash": { label: "Coups de pompe en après-midi", group: "Énergie & Fatigue" },
        "unrefreshed-sleep": { label: "Réveil non reposé / sans avoir récupéré", group: "Énergie & Fatigue" },
        "brain-fog": { label: "Brouillard mental, mauvaise concentration, oublis", group: "Énergie & Fatigue" },
        "anxiety": { label: "Anxiété ou inquiétude", group: "Humeur, Stress & Sommeil" },
        "low-mood": { label: "Humeur basse / tristesse", group: "Humeur, Stress & Sommeil" },
        "irritability": { label: "Irritabilité / sautes d'humeur", group: "Humeur, Stress & Sommeil" },
        "stress-overwhelm": { label: "Difficultés à gérer le stress", group: "Humeur, Stress & Sommeil" },
        "trouble-falling-asleep": { label: "Difficultés à s'endormir", group: "Humeur, Stress & Sommeil" },
        "waking-at-night": { label: "Réveils nocturnes / sommeil agité", group: "Humeur, Stress & Sommeil" },
        "brittle-nails": { label: "Ongles cassants ou fragiles", group: "Cheveux, Peau & Ongles" },
        "hair-loss": { label: "Chute ou amincissement des cheveux", group: "Cheveux, Peau & Ongles" },
        "dry-skin": { label: "Peau sèche ou squameuse", group: "Cheveux, Peau & Ongles" },
        "slow-healing": { label: "Cicatrisation lente des plaies", group: "Cheveux, Peau & Ongles" },
        "premature-graying": { label: "Grisonnement prématuré", group: "Cheveux, Peau & Ongles" },
        "muscle-cramps": { label: "Crampes ou contractions musculaires", group: "Muscles, Articulations & Récupération" },
        "joint-stiffness": { label: "Raideur ou douleurs articulaires", group: "Muscles, Articulations & Récupération" },
        "general-weakness": { label: "Faiblesse musculaire générale", group: "Muscles, Articulations & Récupération" },
        "slow-recovery": { label: "Récupération lente après l'effort", group: "Muscles, Articulations & Récupération" },
        "frequent-illness": { label: "Rhumes fréquents, infections ou cicatrisation lente", group: "Immunité" },
        "seasonal-allergies": { label: "Aggravation des allergies saisonnières", group: "Immunité" },
        "bloating-gas": { label: "Ballonnements ou gaz", group: "Digestion & Intestin" },
        "indigestion": { label: "Indigestion / brûlures d'estomac", group: "Digestion & Intestin" },
        "constipation": { label: "Constipation", group: "Digestion & Intestin" },
        "food-sensitivities": { label: "Sensibilités alimentaires ou inconforts après les repas", group: "Digestion & Intestin" },
        "bone-density-concern": { label: "Préoccupation de densité osseuse ou d'ostéoporose", group: "Santé osseuse & Vieillissement" },
        "age-related-decline": { label: "Déclin lié à l'âge : mémoire, énergie ou vision", group: "Santé osseuse & Vieillissement" },
        "restrictive-diet": { label: "Régime végane ou très restrictif", group: "Carences alimentaires & Étapes de vie" },
        "pregnancy-planning": { label: "Enceinte ou essai de conception", group: "Carences alimentaires & Étapes de vie" },
        "post-surgery": { label: "Récupération post-opératoire ou après blessure", group: "Carences alimentaires & Étapes de vie" },
        "poor-nutrition": { label: "Alimentation peu variée ou repas sautés", group: "Carences alimentaires & Étapes de vie" },
        "muscle-building": { label: "Prise de masse musculaire", group: "Fitness & Objectifs corporels" },
        "weight-management-goal": { label: "Gestion du poids ou perte de graisse", group: "Fitness & Objectifs corporels" },
        "gym-performance": { label: "Performance sportive ou endurance", group: "Fitness & Objectifs corporels" },
        "attention-focus": { label: "Difficultés de concentration, facilement distrait, mal à terminer les tâches", group: "Attention & Concentration" },
        "poor-appetite": { label: "Manque d'appétit ou alimentation insuffisante", group: "Appétit" },
        "sugar-cravings": { label: "Envies de sucre ou hyperphagie", group: "Appétit" },
        "poor-satiety": { label: "Faible sensation de satiété après les repas", group: "Appétit" },
        none: { label: "Aucune plainte" },
      },
    },
    allergies: {
      section: "Préférences",
      question: "Avez-vous des allergies ou des sensibilités ?",
      subtitle:
        "Sélectionnez tout ce qui s'applique. Cela filtre les recommandations de produits inadaptés.",
      options: {
        shellfish: { label: "Crustacés et fruits de mer" },
        soy: { label: "Soja" },
        gluten: { label: "Gluten" },
        fish: { label: "Poisson" },
        dairy: { label: "Produits laitiers" },
        none: { label: "Aucune" },
      },
    },
    form: {
      section: "Préférences",
      question: "Quelle forme de compléments préférez-vous ?",
      options: {
        capsules: { label: "Gélules / Comprimés" },
        gummies: { label: "Gommes" },
        powder: { label: "Poudre" },
        liquid: { label: "Liquide" },
        "no-preference": { label: "Pas de préférence" },
      },
    },
    currency: {
      section: "Préférences",
      question: "Quelle devise préférez-vous ?",
      options: {
        usd: { label: "USD ($)" },
        eur: { label: "EUR (€)" },
        gbp: { label: "GBP (£)" },
        try: { label: "TRY (₺)" },
      },
    },
    budget: {
      section: "Préférences",
      question: "Quel est votre budget mensuel pour les compléments ?",
      options: {
        starter: {
          label: "Débutant",
          description: "$15–25 / €14–23 / £12–20 / ₺510–850",
        },
        budget: {
          label: "Économique",
          description: "$25–50 / €23–46 / £20–40 / ₺850–1 700",
        },
        mid: {
          label: "Milieu de gamme",
          description: "$50–100 / €46–92 / £40–80 / ₺1 700–3 400",
        },
        premium: {
          label: "Premium",
          description: "$100–150 / €92–138 / £80–120 / ₺3 400–5 100",
        },
        ultra: {
          label: "Ultra",
          description: "$150+ / €138+ / £120+ / ₺5 100+",
        },
      },
    },
    newsletter: {
      section: "Restez informé",
      question: "Souhaitez-vous recevoir des conseils mensuels validés par un pharmacien ?",
      subtitle:
        "Rejoignez notre newsletter gratuite — nouvelles recherches, démystification et alertes produits.",
      options: {
        yes: { label: "Oui, inscrivez-moi !" },
        no: { label: "Non merci, montrez simplement mes résultats" },
      },
    },
  },

  supplements: {
    "vitamin-d3": {
      category: "Vitamine",
      primaryBenefit: "Santé osseuse & Immunité",
      pharmacistNote:
        "À associer avec la K2 (MK-7) pour un bon acheminement du calcium. Faites d'abord un dosage sanguin si possible. Objectif : 40–60 ng/mL.",
    },
    magnesium: {
      category: "Minéral",
      primaryBenefit: "Sommeil & Relaxation musculaire",
      pharmacistNote:
        "La forme oxyde est très mal absorbée (~4 %). Le glycinate est la référence. La majorité des adultes sont carencés.",
    },
    "omega-3": {
      category: "Acide gras essentiel",
      primaryBenefit: "Santé cardiovasculaire & Inflammation",
      pharmacistNote:
        "Vérifiez la certification IFOS. Origine algale pour les véganes. Une odeur de poisson signifie une absence de pellicule gastrorésistante.",
    },
    probiotics: {
      category: "Santé intestinale",
      primaryBenefit: "Santé digestive",
      pharmacistNote:
        "La spécificité de la souche est importante : L. rhamnosus GG (intestin), B. longum (humeur). Réfrigéré généralement supérieur à la conservation à température ambiante.",
    },
    "vitamin-b12": {
      category: "Vitamine",
      primaryBenefit: "Énergie & Fonction nerveuse",
      pharmacistNote:
        "Essentielle pour les véganes et végétariens. La metformine appauvrit la B12. La forme sublinguale contourne les problèmes d'absorption intestinale.",
    },
    zinc: {
      category: "Minéral",
      primaryBenefit: "Immunité & Santé cutanée",
      pharmacistNote:
        "DOIT être équilibré avec du cuivre (2 mg de Cu pour 15 mg de Zn). Ne pas prendre avec du fer ou du calcium — ils entrent en compétition pour l'absorption.",
    },
    ashwagandha: {
      category: "Adaptogène",
      primaryBenefit: "Réduction du stress",
      pharmacistNote:
        "À éviter avec les médicaments thyroïdiens (peut augmenter les hormones thyroïdiennes). Famille des solanacées. Cycle de 8 semaines de prise, 2 semaines d'arrêt.",
    },
    curcumin: {
      category: "Anti-inflammatoire",
      primaryBenefit: "Douleurs articulaires & Inflammation",
      pharmacistNote:
        "La pipérine augmente l'absorption de 2 000 %. Les gélules de curcuma ordinaire sont pratiquement sans effet thérapeutique.",
    },
    collagen: {
      category: "Protéine",
      primaryBenefit: "Peau & Soutien articulaire",
      pharmacistNote:
        "À associer obligatoirement avec la vitamine C pour la synthèse du collagène. Marin > bovin pour la peau. Les résultats apparaissent en 8 à 12 semaines.",
    },
    creatine: {
      category: "Performance",
      primaryBenefit: "Force musculaire & Puissance",
      pharmacistNote:
        "Le complément le plus étudié de l'histoire. Pas besoin de cycliser. Pas besoin de phase de charge. Peut provoquer une légère rétention d'eau initiale.",
    },
    "vitamin-c": {
      category: "Vitamine",
      primaryBenefit: "Immunité & Antioxydant",
      pharmacistNote:
        "Les mégadoses (5 g+) provoquent des troubles digestifs. Prendre avec des aliments riches en fer pour améliorer l'absorption du fer. Les fumeurs ont besoin de 35 mg supplémentaires par jour.",
    },
    iron: {
      category: "Minéral",
      primaryBenefit: "Énergie & Santé sanguine",
      pharmacistNote:
        "NE PAS supplémenter sans carence confirmée (analyse sanguine). Ne jamais prendre avec du calcium, du zinc ou du café. Séparer des médicaments thyroïdiens d'au moins 4 heures.",
    },
    "l-theanine": {
      category: "Acide aminé",
      primaryBenefit: "Concentration sereine & Réduction de l'anxiété",
      pharmacistNote:
        "200 mg de L-théanine + 100 mg de caféine = la combinaison nootropique idéale. Pas de somnolence. Compatible avec la plupart des médicaments.",
    },
    "vitamin-k2": {
      category: "Vitamine",
      primaryBenefit: "Santé osseuse & Cardiovasculaire",
      pharmacistNote:
        "ESSENTIELLE si vous prenez de la vitamine D — la D augmente l'absorption du calcium, la K2 le dirige là où il doit aller. CONTRE-INDIQUÉE avec la warfarine.",
    },
    coq10: {
      category: "Antioxydant",
      primaryBenefit: "Santé cardiovasculaire & Énergie cellulaire",
      pharmacistNote:
        "INDISPENSABLE pour toute personne sous statines — les statines épuisent la CoQ10 et provoquent des douleurs musculaires. Forme Ubiquinol préférée après 40 ans.",
    },
    melatonin: {
      category: "Hormone",
      primaryBenefit: "Endormissement",
      pharmacistNote:
        "Moins c'est plus — 0,5 mg fonctionne souvent mieux que 5 mg. Déconseillé en usage quotidien prolongé sans suivi médical. Peut aggraver la dépression chez certains.",
    },
    nac: {
      category: "Acide aminé",
      primaryBenefit: "Soutien hépatique & Détoxification",
      pharmacistNote:
        "Efficacité prouvée dans la toxicité au paracétamol. Données émergentes pour le TOC/trichotillomanie. Prendre avec de la vitamine C pour prévenir l'oxydation.",
    },
    berberine: {
      category: "Plante médicinale",
      primaryBenefit: "Régulation de la glycémie",
      pharmacistNote:
        "INTERACTIONS MÉDICAMENTEUSES FORTES — imite le mécanisme de la metformine. Ne pas combiner avec la metformine sans supervision médicale. Peut abaisser la tension artérielle.",
    },
    electrolytes: {
      category: "Complexe minéral",
      primaryBenefit: "Hydratation & Performance",
      pharmacistNote:
        "Indispensable lors du jeûne, en régime keto et en cas de transpiration abondante. La plupart des boissons sportives commerciales contiennent trop de sucre et pas assez de sodium.",
    },
    "fiber-psyllium": {
      category: "Digestif",
      primaryBenefit: "Régularité intestinale & Cholestérol",
      pharmacistNote:
        "Commencer à faible dose (3 g) et augmenter progressivement pour éviter les ballonnements. Il est IMPÉRATIF de boire suffisamment d'eau. Séparer des médicaments d'au moins 2 heures.",
    },
  },
}
