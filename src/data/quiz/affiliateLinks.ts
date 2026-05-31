export type AmazonStore = "us" | "uk" | "de";

export interface AffiliateLinks {
  us?: string;
  uk?: string;
  de?: string;
}

const BASES = {
  us: "https://www.amazon.com/dp",
  uk: "https://www.amazon.co.uk/dp",
  de: "https://www.amazon.de/dp",
} as const;

const TAGS = {
  us: "nutripedia00-20",
  uk: "nutripedia011-21",
  de: "nutripedia02-21",
} as const;

function l(store: AmazonStore, asin: string): string {
  return `${BASES[store]}/${asin}?tag=${TAGS[store]}`;
}

// Products chosen to match each supplement's recommended "best form".
// ASINs verified May 2026 — re-check if any link returns a 404.
export const affiliateLinks: Record<string, AffiliateLinks> = {
  "vitamin-d3": {
    // Thorne Vitamin D-5,000 (Cholecalciferol D3)
    us: l("us", "B0797HQFGT"),
    uk: l("uk", "B07BBN2NQ2"),
    de: l("de", "B07BBN2NQ2"),
  },
  "magnesium": {
    // Doctor's Best High Absorption Magnesium Glycinate 200mg
    us: l("us", "B000BD0RT0"),
    uk: l("uk", "B09BVYSJ5F"),
    de: l("de", "B09BVYSJ5F"),
  },
  "omega-3": {
    // Nordic Naturals Ultimate Omega 1280mg (triglyceride form)
    us: l("us", "B002CQU564"),
    uk: l("uk", "B0C7KV8LZQ"),
    de: l("de", "B0C7KV8LZQ"),
  },
  "probiotics": {
    // Garden of Life Raw Probiotics Ultimate Care (multi-strain)
    us: l("us", "B00AR0ENJ2"),
    uk: l("uk", "B0DNYH9CDN"),
    de: l("de", "B01DSVVN44"),
  },
  "vitamin-b12": {
    // Jarrow Methyl B-12 1000mcg (methylcobalamin)
    us: l("us", "B002FJW3ZY"),
    uk: l("uk", "B0BK97J6SF"),
    de: l("de", "B0BK97FH68"),
  },
  "zinc": {
    // Thorne Zinc Picolinate 15mg
    us: l("us", "B0797NSHQX"),
    uk: l("uk", "B0797NSHQX"),
    de: l("de", "B0797NSHQX"),
  },
  "ashwagandha": {
    // Jarrow Formulas Ashwagandha 300mg KSM-66 extract
    us: l("us", "B0013OQEO8"),
    uk: l("uk", "B0BLRSZDLG"),
    de: l("de", "B0BLRSZDLG"),
  },
  "curcumin": {
    // Doctor's Best Curcumin 1000mg with BioPerine
    us: l("us", "B000BD0RQS"),
    uk: l("uk", "B0C7L1J9Y5"),
    de: l("de", "B09K3XC8L8"),
  },
  "collagen": {
    // Vital Proteins Collagen Peptides (hydrolyzed Type I+III)
    us: l("us", "B00K6JUG4K"),
    uk: l("uk", "B07FP2MSJP"),
    de: l("de", "B07YLKCQZT"),
  },
  "creatine": {
    // Optimum Nutrition Micronized Creatine Monohydrate (Creapure)
    us: l("us", "B002DYIZEO"),
    uk: l("uk", "B00T7L20EC"),
    de: l("de", "B00T7L20EC"),
  },
  "vitamin-c": {
    // LivOn Labs Lypo-Spheric Liposomal Vitamin C 1000mg
    us: l("us", "B000CD9XGC"),
    uk: l("uk", "B0CMR396GS"),
    de: l("de", "B0174576VE"),
  },
  "iron": {
    // Thorne Iron Bisglycinate 25mg
    // UK/DE: no standalone Thorne listing confirmed — omitted
    us: l("us", "B0797GZDZL"),
  },
  "l-theanine": {
    // NOW Foods L-Theanine 200mg (Suntheanine)
    us: l("us", "B000H7P9M0"),
    uk: l("uk", "B09SPMYGHQ"),
    de: l("de", "B09SPMYGHQ"),
  },
  "vitamin-k2": {
    // Jarrow Formulas MK-7 90mcg (menaquinone-7)
    us: l("us", "B00TOASYM8"),
    uk: l("uk", "B0BJQDB17N"),
    de: l("de", "B0BJQDB17N"),
  },
  "coq10": {
    // Jarrow QH-Absorb Ubiquinol 100mg (active form)
    us: l("us", "B004VCOOUU"),
    uk: l("uk", "B0BK9HD79H"),
    de: l("de", "B0BK9HD79H"),
  },
  "melatonin": {
    // Life Extension Melatonin 300mcg (low-dose)
    // UK: OTC melatonin is prescription-only — omitted
    us: l("us", "B000X9QZZ2"),
    de: l("de", "B0DW934BDV"),
  },
  "nac": {
    // NOW Foods NAC 600mg
    us: l("us", "B0013OUQ3S"),
    uk: l("uk", "B09R7RKT1P"),
    de: l("de", "B09R7RKT1P"),
  },
  "berberine": {
    // Thorne Berberine-500
    us: l("us", "B00QWUEC7O"),
    uk: l("uk", "B00QWUEC7O"),
    de: l("de", "B00QWUEC7O"),
  },
  "electrolytes": {
    // LMNT Zero Sugar Electrolytes Variety Pack
    us: l("us", "B084HQ4DYQ"),
    uk: l("uk", "B084HQ4DYQ"),
    de: l("de", "B084HQ4DYQ"),
  },
  "fiber-psyllium": {
    // NOW Foods Psyllium Husk Powder
    us: l("us", "B002RWUNYM"),
    uk: l("uk", "B00H4H1WHC"),
    de: l("de", "B0CZXJZVK3"),
  },
};

/** Returns the affiliate URL for a supplement + currency, or null if unavailable. */
export function getAffiliateLink(supplementId: string, currency: string): string | null {
  const storeMap: Record<string, AmazonStore | null> = {
    usd: "us",
    gbp: "uk",
    eur: "de",
    try: null,
  };
  const store = storeMap[currency] ?? null;
  if (!store) return null;
  return affiliateLinks[supplementId]?.[store] ?? null;
}
