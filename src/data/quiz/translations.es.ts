import type { QuizTranslations } from './translations'

export const es: QuizTranslations = {
  ui: {
    awaiting: {
      title: 'Pendiente de revisión',
      subtitle: (name) => `${name} está revisando tus resultados de suplementos.`,
      timerLabel: 'LA REVISIÓN CIERRA EN',
      infoText: 'Un farmacéutico colegiado está comprobando tus respuestas y puede ajustar tu plan de suplementos antes de que veas los resultados finales.',
      cancelBtn: 'Elegir otro farmacéutico',
    },
    landing: {
      badge: "Test diseñado por un farmacéutico",
      titleLine1: "¿Qué suplementos",
      titleLine2: "necesitas realmente?",
      subtitle:
        "Deja de adivinar. Un farmacéutico colegiado creó este test para desenredar la realidad del marketing — obtén un plan de suplementos personalizado según tus objetivos de salud, medicamentos y estilo de vida. Con un análisis de interacciones que ningún influencer puede ofrecer.",
      cta: "Hacer el test gratuito →",
      minutes: "3 minutos",
      questions: "16 preguntas",
      free: "100 % gratuito",
      trustPharmacist: "Diseñado por un farmacéutico colegiado",
      trustInteraction: "Análisis de interacciones farmacológicas",
      trustEvidence: "Recomendaciones basadas en evidencia científica",
      whatYouGetTitle: "Lo que obtendrás",
      feature1Title: "Plan personalizado",
      feature1Desc:
        "Suplementos elegidos específicamente para tu edad, objetivos, dieta y estilo de vida — no consejos genéricos.",
      feature2Title: "Análisis de seguridad",
      feature2Desc:
        "Tu plan se cruza con tus medicamentos para detectar interacciones peligrosas. Ningún influencer hace esto.",
      feature3Title: "Horario de toma",
      feature3Desc:
        "Exactamente cuándo tomar cada suplemento y por qué — porque el momento de la toma afecta la absorción hasta un 75 %.",
      readyCTA: "¿Listo para descubrir lo que realmente necesitas?",
      startCTA: "Empezar el test →",
    },
    quiz: {
      back: "← Atrás",
      continue: "Continuar →",
      skip: "Saltar →",
      selectAll: "Selecciona todo lo que aplique",
      of: "de",
      other: "Otro",
      otherPlaceholder: "Escribe y pulsa Intro...",
    },
    results: {
      badge: "Tus resultados personalizados",
      title: "Tu plan de suplementos",
      recommendedTitle: "Tus suplementos recomendados",
      interactionTitle: "Alertas de interacciones",
      scheduleTitle: "Tu horario diario de toma",
      scheduleNote:
        "El momento de la toma afecta la absorción hasta un 75 %. Sigue este horario para obtener la máxima eficacia.",
      notesTitle: "Notas importantes",
      retake: "← Repetir el test",
      share: "Compartir tus resultados 📤",
      shareText:
        "¡Acabo de recibir mi plan de suplementos personalizado gracias a un test diseñado por un farmacéutico!",
      linkCopied: "¡Enlace copiado al portapapeles!",
      downloadPdf: "Descargar PDF ↓",
      priority: {
        essential: "Esencial",
        recommended: "Recomendado",
        optional: "Opcional",
      },
      bestForm: "Mejor forma",
      dose: "Dosis",
      timing: "Momento de toma",
      withFood: "Con comida",
      withFoodYes: "Sí ✓",
      withFoodNo: "No — con el estómago vacío",
      withFoodOptional: "Opcional",
      pharmacistTip: "💡 Consejo del farmacéutico:",
      viewProduct: "Comprar este producto →",
      evidenceLabel: "Evidencia",
      perMonth: "/mes",
      back: "← Atrás",
      backToApp: "← Volver a la app",
    },
    loading: {
      title: "Diseñando tu plan",
      subtitle: "Tu farmacéutico está revisando tus respuestas...",
      steps: [
        { emoji: "🔍", text: "Analizando tu perfil..." },
        { emoji: "💊", text: "Asociando suplementos a tus objetivos..." },
        { emoji: "⚠️", text: "Analizando interacciones farmacológicas..." },
        { emoji: "⏰", text: "Elaborando tu horario de toma..." },
        { emoji: "✅", text: "Finalizando tu plan..." },
      ],
    },
  },

  engine: {
    goalLabels: {
      energy: "Energía & Vitalidad",
      sleep: "Mejor sueño",
      immunity: "Apoyo inmunológico",
      joints: "Salud articular",
      stress: "Alivio del estrés & Ansiedad",
      cognitive: "Cerebro & Concentración",
      athletic: "Rendimiento deportivo",
      gut: "Salud intestinal",
      heart: "Salud cardiovascular",
      skin: "Piel, cabello & Uñas",
      weight: "Control de peso",
      longevity: "Longevidad & Antienvejecimiento",
    },
    coreReason: (g) => `Suplemento clave para ${g}`,
    supportsReason: (g) => `Apoya ${g}`,
    additionalReason: (g) => `Apoyo adicional para ${g}`,
    secondaryKeyReason: (g) => `Esencial para el objetivo secundario: ${g}`,
    secondarySupportsReason: (g) => `Apoya ${g}`,
    reasons: {
      veganB12: "Crítico para veganos — los alimentos vegetales no contienen B12",
      veganIron: "Los veganos tienen mayor riesgo de déficit de hierro",
      veganOmega3:
        "Usar fuente de algas — ácidos grasos esenciales ausentes en las dietas veganas",
      vegetarianB12: "Los vegetarianos suelen tener niveles de B12 por debajo de lo óptimo",
      ketoElectrolytes:
        "La dieta keto agota los electrolitos rápidamente — la 'gripe keto' suele ser un déficit de electrolitos",
      ketoMagnesium: "La dieta keto aumenta la pérdida de magnesio",
      minimalSunD3:
        "Principalmente en interiores = déficit de vitamina D casi seguro. El suplemento de mayor impacto individual.",
      highStressAshwagandha:
        "El estrés elevado agota el magnesio y las vitaminas B más rápidamente",
      highStressMagnesium: "El estrés acelera el consumo de magnesio",
      poorSleepMagnesium:
        "Sueño deficiente — el glicinato de magnesio activa el GABA para favorecer la relajación",
      poorSleepTheanine:
        "Favorece las ondas cerebrales alfa para facilitar el inicio del sueño",
      heavyCreatine:
        "Entrenamiento intensivo — la creatina apoya la potencia muscular y la recuperación",
      heavyElectrolytes: "La sudoración abundante agota los minerales de forma significativa",
      femalePre:
        "Las mujeres premenopáusicas tienen mayores necesidades de hierro por la menstruación",
      femalePostD3: "Protección de la densidad ósea tras la menopausia",
      femalePostK2: "Dirige el calcio hacia los huesos (esencial tras la menopausia)",
      statinsCoq10:
        "Las estatinas agotan la CoQ10 — la causa n.º 1 del dolor muscular por estatinas. Es el complemento obligatorio de tu estatina.",
      metforminB12:
        "Está demostrado que la metformina agota la B12 con el tiempo. Hazte analíticas anuales.",
      coq10AgeSuffix:
        " Usar la forma Ubiquinol — la capacidad de conversión disminuye a partir de los 40 años.",
      algaeAllergySuffix:
        " (Usar fuente de ALGAS — no aceite de pescado por tu alergia)",
      sym: {
        fatigue: "Aborda directamente tu fatiga crónica y tu falta de energía",
        afternoonCrash: "Mantiene la energía estable para evitar el bajón de la tarde",
        unrefreshedSleep: "Mejora la profundidad del sueño y el despertar descansado",
        brainFog: "Actúa directamente sobre la niebla mental, la concentración y la memoria",
        anxiety: "Respaldado clínicamente para la ansiedad y la respuesta al estrés",
        lowMood: "Apoya el equilibrio de neurotransmisores para el estado de ánimo",
        irritability: "La irritabilidad agota el magnesio y las vitaminas B más rápidamente",
        stressOverwhelm: "Apoyo adaptogénico para la resiliencia al estrés",
        sleepOnset: "Favorece la activación del GABA y el inicio del sueño",
        sleepQuality: "Apoya la continuidad del sueño y el sueño profundo",
        brittleNails: "El zinc y el colágeno son nutrientes estructurales clave para las uñas",
        hairLoss: "Aborda el zinc, el colágeno y el hierro como causas frecuentes de caída del cabello",
        drySkin: "Los omega-3 y el colágeno apoyan la barrera cutánea y la hidratación",
        slowHealing: "La vitamina C y el zinc son esenciales para la reparación tisular",
        graying: "El déficit de B12 está vinculado a las canas prematuras",
        cramps: "El déficit de magnesio y electrolitos es la causa más frecuente de calambres",
        jointPain: "Los omega-3 y la curcumina reducen la inflamación y la rigidez articular",
        weakness: "Los déficits de B12 y hierro son causas frecuentes de debilidad general",
        slowRecovery: "Apoya la recuperación post-ejercicio y la reparación muscular",
        frequentIllness: "Apoyo inmunológico fundamental: vitamina D, zinc y vitamina C",
        allergies: "Modula la hipersensibilidad inmune y la intensidad de las alergias estacionales",
        bloating: "Los probióticos y la fibra restauran el equilibrio intestinal y reducen la hinchazón",
        indigestion: "Apoyo probiótico para el equilibrio de enzimas digestivas",
        constipation: "La fibra de psyllium y el magnesio favorecen la regularidad intestinal",
        foodSens: "Microbioma intestinal e integridad de la barrera para las sensibilidades alimentarias",
        boneDensity: "Apoyo crítico a la densidad ósea: D3, K2 y magnesio",
        agingDecline: "Apoyo antienvejecimiento cerebral y de energía celular",
        restrictiveDiet: "Cubre las carencias nutricionales clave de una alimentación restrictiva",
        pregnancy: "Apoya la salud materna y fetal durante el embarazo",
        postSurgery: "Apoya la cicatrización tisular y la recuperación postoperatoria",
        poorNutrition: "Corrige las carencias habituales de una dieta poco variada",
        muscleBuilding: "La creatina es el suplemento con mayor respaldo científico para ganar músculo",
        weightGoal: "Apoya la saciedad y la glucemia para el control de peso",
        gymPerformance: "Apoya el rendimiento deportivo, la resistencia y la recuperación",
        attention: "Los omega-3 y la L-teanina mejoran la atención y la concentración",
        poorAppetite: "El déficit de zinc es una causa frecuente y reversible de falta de apetito",
        sugarCravings: "La berberina y la fibra regulan la glucemia y reducen los antojos de azúcar",
        poorSatiety: "La fibra y la berberina mejoran la señal de saciedad",
      },
    },
    doseAdjustments: {
      vitaminD3LowSun:
        "Empezar con 4 000 UI/día (dosis más alta por exposición solar mínima)",
      b12Vegan: "2 500 mcg/día (dosis más alta al ser la única fuente)",
      magnesiumHeavy: "400–500 mg/día (aumentado por entrenamiento intensivo)",
      electrolytesKeto: "2–3 porciones/día durante la adaptación a la dieta keto",
    },
    timingSlots: {
      morning: "Mañana (con el desayuno)",
      midMorning: "Media mañana",
      lunch: "Almuerzo",
      evening: "Noche (antes de dormir)",
      anytime: "En cualquier momento (la constancia es lo que importa)",
    },
    timingNotes: {
      iron: "Tomar con vitamina C, alejado del café",
      fiber: "Con un vaso grande de agua",
      takeWithFood: "Tomar con comida",
    },
    summary: (count, primary, secondary, essentialCount, totalWarnings) =>
      `Según tu perfil, he diseñado un plan de ${count} suplemento${count !== 1 ? 's' : ''} orientado a ${primary}${
        secondary ? ` y ${secondary}` : ""
      }. ${essentialCount} ${essentialCount !== 1 ? 'son esenciales' : 'es esencial'} para tu situación específica${
        totalWarnings > 0
          ? `, y he señalado ${totalWarnings} interacción${totalWarnings !== 1 ? 'es' : ''} que debes tener en cuenta`
          : ""
      }.`,
    disclaimers: {
      base: [
        "Este test proporciona orientación educativa y no sustituye el consejo médico profesional.",
        "Consulta a tu profesional de salud antes de iniciar cualquier régimen de suplementos.",
      ],
      removedSupplements: (count, names) =>
        `${count} suplemento${count !== 1 ? 's han sido excluidos' : ' ha sido excluido'} debido a interacciones con tus medicamentos: ${names}.`,
      bloodThinners:
        "Estás tomando anticoagulantes. Cualquier suplemento nuevo debe ser aprobado por tu farmacéutico o médico.",
    },
  },

  questions: {
    age: {
      section: "Sobre ti",
      question: "¿Cuál es tu rango de edad?",
      options: {
        "20-30": { label: "20–30" },
        "30-40": { label: "30–40" },
        "40-50": { label: "40–50" },
        "50-60": { label: "50–60" },
      },
    },
    sex: {
      section: "Sobre ti",
      question: "¿Cuál es tu sexo biológico?",
      subtitle: "Esto influye en los requerimientos nutricionales y las recomendaciones de dosis.",
      options: {
        male: { label: "Hombre" },
        female: { label: "Mujer" },
      },
    },
    menopause: {
      section: "Sobre ti",
      question: "¿Estás en la menopausia?",
      options: {
        post: { label: "Sí (en la menopausia)" },
        pre: { label: "No (no estoy en la menopausia)" },
        unsure: { label: "En transición hacia la menopausia (perimenopausia)" },
      },
    },
    medications: {
      section: "Sobre ti",
      question: "¿Estás tomando algún medicamento actualmente?",
      subtitle:
        "Esta información es crucial para comprobar las interacciones suplemento-medicamento. Selecciona todo lo que aplique.",
      options: {
        statins: { label: "Estatinas (colesterol)" },
        metformin: { label: "Metformina (diabetes)" },
        "blood-thinners": { label: "Anticoagulantes (warfarina, etc.)" },
        thyroid: { label: "Medicación tiroidea" },
        ssri: { label: "Antidepresivos (ISRS)" },
        ppi: { label: "Antiácidos / IBP" },
        "bp-meds": { label: "Medicación antihipertensiva" },
        "birth-control": { label: "Anticonceptivos" },
        antihistamines: { label: "Antihistamínicos (cetirizina, loratadina)" },
        corticosteroids: { label: "Corticosteroides (prednisona)" },
        "osteoporosis-meds": { label: "Medicamentos para la osteoporosis (bisfosfonatos)" },
        "sleep-aids": { label: "Somníferos (zolpidem, benzodiacepinas)" },
        antibiotics: { label: "Antibióticos (ciclo en curso)" },
        antifungals: { label: "Antifúngicos" },
        immunosuppressants: { label: "Inmunosupresores" },
        "seizure-meds": { label: "Antiepilépticos (anticonvulsivantes)" },
        hrt: { label: "Terapia hormonal sustitutiva (THS)" },
        "anti-asthmatic": { label: "Antiasmáticos (inhaladores, montelukast)" },
        "anti-neoplastic": { label: "Antineoplásicos (quimioterapia)" },
        none: { label: "Ninguno" },
      },
    },
    diet: {
      section: "Tu estilo de vida",
      question: "¿Cómo describirías tu alimentación?",
      options: {
        omnivore: { label: "Omnívoro", description: "Como de todo" },
        vegetarian: {
          label: "Vegetariano",
          description: "Sin carne, pero con huevos y lácteos",
        },
        vegan: { label: "Vegano", description: "100 % vegetal" },
        keto: {
          label: "Keto / Bajo en carbohidratos",
          description: "Alto en grasas, bajo en carbohidratos",
        },
        mediterranean: {
          label: "Mediterránea",
          description: "Alimentos integrales, aceite de oliva, pescado",
        },
        "no-specific": {
          label: "Sin dieta específica",
          description: "Como lo que encuentro",
        },
      },
    },
    exercise: {
      section: "Tu estilo de vida",
      question: "¿Con qué frecuencia haces ejercicio?",
      options: {
        rarely: { label: "Raramente", description: "Menos de una vez por semana" },
        light: { label: "1–2 veces por semana", description: "Actividad ligera" },
        moderate: { label: "3–4 veces por semana", description: "Entrenamientos regulares" },
        heavy: { label: "5+ días por semana", description: "Entrenamiento intensivo" },
      },
    },
    stress: {
      section: "Tu estilo de vida",
      question: "¿Cómo valorarías tu nivel de estrés?",
      options: {
        low: { label: "Bajo (1–3)", description: "Generalmente relajado" },
        moderate: {
          label: "Moderado (4–6)",
          description: "Estrés normal del día a día",
        },
        high: {
          label: "Alto (7–10)",
          description: "Con frecuencia desbordado",
        },
      },
    },
    sleep: {
      section: "Tu estilo de vida",
      question: "¿Cómo es la calidad de tu sueño?",
      options: {
        great: {
          label: "Excelente",
          description: "Me duermo con facilidad y me quedo dormido",
        },
        okay: { label: "Aceptable", description: "Problemas ocasionales" },
        poor: {
          label: "Mala",
          description: "Dificultades frecuentes para dormirme o mantenerme dormido",
        },
      },
    },
    sun: {
      section: "Tu estilo de vida",
      question: "¿Cuánta exposición solar recibes a diario?",
      options: {
        lots: { label: "Mucha", description: "Trabajo o vida al aire libre" },
        some: { label: "Algo", description: "30 minutos o más al día" },
        minimal: { label: "Mínima", description: "Principalmente en interiores" },
      },
    },
    "primary-goal": {
      section: "Tus objetivos",
      question: "¿Cuál es tu objetivo de salud principal?",
      subtitle: "Elige el que más te importa ahora mismo.",
      options: {
        energy: { label: "Energía & Vitalidad" },
        sleep: { label: "Mejor sueño" },
        immunity: { label: "Apoyo inmunológico" },
        joints: { label: "Salud articular & Movilidad" },
        stress: { label: "Estrés & Ansiedad" },
        cognitive: { label: "Cerebro & Concentración" },
        athletic: { label: "Rendimiento deportivo" },
        gut: { label: "Salud intestinal & Digestión" },
        heart: { label: "Salud cardiovascular" },
        skin: { label: "Piel, cabello & Uñas" },
        weight: { label: "Control de peso" },
        longevity: { label: "Longevidad & Antienvejecimiento" },
      },
    },
    "secondary-goal": {
      section: "Tus objetivos",
      question: "¿Tienes un objetivo de salud secundario?",
      options: {
        energy: { label: "Energía & Vitalidad" },
        sleep: { label: "Mejor sueño" },
        immunity: { label: "Apoyo inmunológico" },
        joints: { label: "Salud articular" },
        stress: { label: "Estrés & Ansiedad" },
        cognitive: { label: "Cerebro & Concentración" },
        athletic: { label: "Rendimiento deportivo" },
        gut: { label: "Salud intestinal" },
        heart: { label: "Salud cardiovascular" },
        skin: { label: "Piel, cabello & Uñas" },
        weight: { label: "Control de peso" },
        longevity: { label: "Longevidad" },
        none: { label: "Sin objetivo secundario" },
      },
    },
    complaints: {
      section: "Tus molestias",
      question: "¿Cuáles son tus molestias o preocupaciones actuales?",
      subtitle: "Selecciona todo lo que aplique — esto permite adaptar tu plan a tus síntomas reales.",
      options: {
        "chronic-fatigue": { label: "Fatiga crónica / siempre cansado", group: "Energía & Fatiga" },
        "afternoon-crash": { label: "Bajón de energía por la tarde", group: "Energía & Fatiga" },
        "unrefreshed-sleep": { label: "Despertar sin haberse recuperado", group: "Energía & Fatiga" },
        "brain-fog": { label: "Niebla mental, mala concentración, olvidos", group: "Energía & Fatiga" },
        "anxiety": { label: "Ansiedad o preocupación", group: "Estado de ánimo, Estrés & Sueño" },
        "low-mood": { label: "Estado de ánimo bajo / tristeza", group: "Estado de ánimo, Estrés & Sueño" },
        "irritability": { label: "Irritabilidad / cambios de humor", group: "Estado de ánimo, Estrés & Sueño" },
        "stress-overwhelm": { label: "Dificultad para manejar el estrés", group: "Estado de ánimo, Estrés & Sueño" },
        "trouble-falling-asleep": { label: "Dificultad para conciliar el sueño", group: "Estado de ánimo, Estrés & Sueño" },
        "waking-at-night": { label: "Despertares nocturnos / sueño inquieto", group: "Estado de ánimo, Estrés & Sueño" },
        "brittle-nails": { label: "Uñas quebradizas o frágiles", group: "Cabello, Piel & Uñas" },
        "hair-loss": { label: "Caída o adelgazamiento del cabello", group: "Cabello, Piel & Uñas" },
        "dry-skin": { label: "Piel seca o escamosa", group: "Cabello, Piel & Uñas" },
        "slow-healing": { label: "Cicatrización lenta de heridas", group: "Cabello, Piel & Uñas" },
        "premature-graying": { label: "Canas prematuras", group: "Cabello, Piel & Uñas" },
        "muscle-cramps": { label: "Calambres o espasmos musculares", group: "Músculos, Articulaciones & Recuperación" },
        "joint-stiffness": { label: "Rigidez o dolor articular", group: "Músculos, Articulaciones & Recuperación" },
        "general-weakness": { label: "Debilidad muscular general", group: "Músculos, Articulaciones & Recuperación" },
        "slow-recovery": { label: "Recuperación lenta tras el ejercicio", group: "Músculos, Articulaciones & Recuperación" },
        "frequent-illness": { label: "Resfriados frecuentes, infecciones o cicatrización lenta", group: "Inmunidad" },
        "seasonal-allergies": { label: "Empeoramiento de las alergias estacionales", group: "Inmunidad" },
        "bloating-gas": { label: "Hinchazón o gases", group: "Digestión & Intestino" },
        "indigestion": { label: "Indigestión / ardor de estómago", group: "Digestión & Intestino" },
        "constipation": { label: "Estreñimiento", group: "Digestión & Intestino" },
        "food-sensitivities": { label: "Sensibilidades alimentarias o molestias tras comer", group: "Digestión & Intestino" },
        "bone-density-concern": { label: "Preocupación por la densidad ósea u osteoporosis", group: "Salud ósea & Envejecimiento" },
        "age-related-decline": { label: "Deterioro de memoria, energía o visión relacionado con la edad", group: "Salud ósea & Envejecimiento" },
        "restrictive-diet": { label: "Dieta vegana o muy restrictiva", group: "Carencias dietéticas & Etapas vitales" },
        "pregnancy-planning": { label: "Embarazada o intentando concebir", group: "Carencias dietéticas & Etapas vitales" },
        "post-surgery": { label: "Recuperación postoperatoria o tras una lesión", group: "Carencias dietéticas & Etapas vitales" },
        "poor-nutrition": { label: "Alimentación poco variada o saltarse comidas", group: "Carencias dietéticas & Etapas vitales" },
        "muscle-building": { label: "Ganar masa muscular", group: "Fitness & Objetivos corporales" },
        "weight-management-goal": { label: "Control de peso o pérdida de grasa", group: "Fitness & Objetivos corporales" },
        "gym-performance": { label: "Rendimiento en el gimnasio o resistencia", group: "Fitness & Objetivos corporales" },
        "attention-focus": { label: "Dificultad para concentrarse, se distrae fácilmente, problemas para terminar tareas", group: "Atención & Concentración" },
        "poor-appetite": { label: "Falta de apetito o comer muy poco", group: "Apetito" },
        "sugar-cravings": { label: "Antojos de azúcar o comer en exceso", group: "Apetito" },
        "poor-satiety": { label: "Poca sensación de saciedad tras las comidas", group: "Apetito" },
        none: { label: "Sin molestias" },
      },
    },
    allergies: {
      section: "Preferencias",
      question: "¿Tienes alguna alergia o sensibilidad?",
      subtitle:
        "Selecciona todo lo que aplique. Esto filtra las recomendaciones de productos no aptos.",
      options: {
        shellfish: { label: "Mariscos y crustáceos" },
        soy: { label: "Soja" },
        gluten: { label: "Gluten" },
        fish: { label: "Pescado" },
        dairy: { label: "Lácteos" },
        none: { label: "Ninguna" },
      },
    },
    form: {
      section: "Preferencias",
      question: "¿Qué forma de suplementos prefieres?",
      options: {
        capsules: { label: "Cápsulas / Comprimidos" },
        gummies: { label: "Gominolas" },
        powder: { label: "Polvo" },
        liquid: { label: "Líquido" },
        "no-preference": { label: "Sin preferencia" },
      },
    },
    currency: {
      section: "Preferencias",
      question: "¿Qué moneda prefieres?",
      options: {
        usd: { label: "USD ($)" },
        eur: { label: "EUR (€)" },
        gbp: { label: "GBP (£)" },
        try: { label: "TRY (₺)" },
      },
    },
    budget: {
      section: "Preferencias",
      question: "¿Cuál es tu presupuesto mensual en suplementos?",
      options: {
        starter: {
          label: "Iniciación",
          description: "$15–25 / €14–23 / £12–20 / ₺510–850",
        },
        budget: {
          label: "Económico",
          description: "$25–50 / €23–46 / £20–40 / ₺850–1.700",
        },
        mid: {
          label: "Gama media",
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
      section: "Mantente informado",
      question: "¿Te gustaría recibir consejos mensuales validados por un farmacéutico?",
      subtitle:
        "Únete a nuestro boletín gratuito — nuevas investigaciones, desmontaje de mitos y alertas de productos.",
      options: {
        yes: { label: "¡Sí, suscríbeme!" },
        no: { label: "No, gracias, muéstrame solo mis resultados" },
      },
    },
  },

  supplements: {
    "vitamin-d3": {
      category: "Vitamina",
      primaryBenefit: "Salud ósea & Inmunidad",
      pharmacistNote:
        "Combinar con K2 (MK-7) para un correcto transporte del calcio. Analizar niveles en sangre primero si es posible. Objetivo: 40–60 ng/mL.",
    },
    magnesium: {
      category: "Mineral",
      primaryBenefit: "Sueño & Relajación muscular",
      pharmacistNote:
        "La forma óxido tiene muy baja absorción (~4 %). El glicinato es el estándar de referencia. La mayoría de los adultos presentan déficit.",
    },
    "omega-3": {
      category: "Ácido graso esencial",
      primaryBenefit: "Salud cardiovascular & Inflamación",
      pharmacistNote:
        "Buscar certificación IFOS. Sin olor a pescado = con cubierta entérica. Fuente de algas para veganos.",
    },
    probiotics: {
      category: "Salud intestinal",
      primaryBenefit: "Salud digestiva",
      pharmacistNote:
        "La especificidad de la cepa es importante: L. rhamnosus GG (intestino), B. longum (estado de ánimo). Refrigerado generalmente superior al de temperatura ambiente.",
    },
    "vitamin-b12": {
      category: "Vitamina",
      primaryBenefit: "Energía & Función nerviosa",
      pharmacistNote:
        "Esencial para veganos y vegetarianos. La metformina agota la B12. La forma sublingual evita los problemas de absorción intestinal.",
    },
    zinc: {
      category: "Mineral",
      primaryBenefit: "Inmunidad & Salud cutánea",
      pharmacistNote:
        "DEBE equilibrarse con cobre (2 mg de Cu por cada 15 mg de Zn). No tomar junto con hierro o calcio — compiten por la absorción.",
    },
    ashwagandha: {
      category: "Adaptógeno",
      primaryBenefit: "Reducción del estrés",
      pharmacistNote:
        "Evitar con medicación tiroidea (puede elevar las hormonas tiroideas). Familia de las solanáceas. Ciclo de 8 semanas de toma, 2 de descanso.",
    },
    curcumin: {
      category: "Antiinflamatorio",
      primaryBenefit: "Dolor articular & Inflamación",
      pharmacistNote:
        "La piperina aumenta la absorción un 2.000 %. Las cápsulas de cúrcuma simple son prácticamente ineficaces desde el punto de vista terapéutico.",
    },
    collagen: {
      category: "Proteína",
      primaryBenefit: "Piel & Apoyo articular",
      pharmacistNote:
        "Combinar obligatoriamente con vitamina C para la síntesis de colágeno. Marino > bovino para la piel. Los resultados se aprecian a las 8–12 semanas.",
    },
    creatine: {
      category: "Rendimiento",
      primaryBenefit: "Fuerza muscular & Potencia",
      pharmacistNote:
        "El suplemento más estudiado de la historia. No necesita ciclado. No necesita fase de carga. Puede causar ligera retención de agua al inicio.",
    },
    "vitamin-c": {
      category: "Vitamina",
      primaryBenefit: "Inmunidad & Antioxidante",
      pharmacistNote:
        "Las megadosis (5 g+) provocan molestias gastrointestinales. Tomar con alimentos ricos en hierro para mejorar su absorción. Los fumadores necesitan 35 mg adicionales al día.",
    },
    iron: {
      category: "Mineral",
      primaryBenefit: "Energía & Salud sanguínea",
      pharmacistNote:
        "NO suplementar sin déficit confirmado mediante análisis de sangre. Nunca tomar junto con calcio, zinc o café. Separar de la medicación tiroidea al menos 4 horas.",
    },
    "l-theanine": {
      category: "Aminoácido",
      primaryBenefit: "Concentración serena & Alivio de la ansiedad",
      pharmacistNote:
        "200 mg de L-teanina + 100 mg de cafeína = la combinación nootrópica ideal. Sin somnolencia. Compatible con la mayoría de los medicamentos.",
    },
    "vitamin-k2": {
      category: "Vitamina",
      primaryBenefit: "Salud ósea & Cardiovascular",
      pharmacistNote:
        "ESENCIAL si se toma vitamina D — la D aumenta la absorción de calcio, la K2 dirige su destino. CONTRAINDICADA con warfarina.",
    },
    coq10: {
      category: "Antioxidante",
      primaryBenefit: "Salud cardiovascular & Energía celular",
      pharmacistNote:
        "IMPRESCINDIBLE para cualquier persona con estatinas — las estatinas agotan la CoQ10 causando dolor muscular. Forma Ubiquinol preferida a partir de los 40 años.",
    },
    melatonin: {
      category: "Hormona",
      primaryBenefit: "Inicio del sueño",
      pharmacistNote:
        "Menos es más — 0,5 mg suele funcionar mejor que 5 mg. No recomendado para uso diario prolongado sin supervisión. Puede empeorar la depresión en algunos casos.",
    },
    nac: {
      category: "Aminoácido",
      primaryBenefit: "Apoyo hepático & Detoxificación",
      pharmacistNote:
        "Eficacia demostrada en la toxicidad por paracetamol. Evidencia emergente para TOC/tricotilomanía. Tomar con vitamina C para evitar la oxidación.",
    },
    berberine: {
      category: "Botánico",
      primaryBenefit: "Regulación de la glucemia",
      pharmacistNote:
        "INTERACCIONES FARMACOLÓGICAS IMPORTANTES — imita el mecanismo de la metformina. No combinar con metformina sin supervisión médica. Puede reducir la presión arterial.",
    },
    electrolytes: {
      category: "Complejo mineral",
      primaryBenefit: "Hidratación & Rendimiento",
      pharmacistNote:
        "Imprescindible en ayuno, dieta keto y sudoración intensa. La mayoría de las bebidas deportivas comerciales contienen demasiado azúcar y muy poco sodio.",
    },
    "fiber-psyllium": {
      category: "Digestivo",
      primaryBenefit: "Regularidad intestinal & Colesterol",
      pharmacistNote:
        "Empezar con dosis baja (3 g) y aumentar gradualmente para evitar hinchazón. Es IMPRESCINDIBLE beber suficiente agua. Separar de los medicamentos al menos 2 horas.",
    },
  },
}
