// ═══════════════════════════════════════════════════════════════
// CURRENCY SYSTEM
// Stores prices in USD as base, converts on display.
// Update rates periodically (especially TRY — it's volatile).
// When the app launches, replace with a live API call.
// ═══════════════════════════════════════════════════════════════

export type CurrencyCode = "usd" | "eur" | "gbp" | "try";

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  rate: number; // 1 USD = X of this currency
  flag: string;
  locale: string;
}

// UPDATE THESE RATES PERIODICALLY
// Last updated: May 2025
// Source: xe.com — check monthly for TRY
export const currencies: Record<CurrencyCode, CurrencyInfo> = {
  usd: {
    code: "usd",
    symbol: "$",
    name: "US Dollar",
    rate: 1,
    flag: "🇺🇸",
    locale: "en-US",
  },
  eur: {
    code: "eur",
    symbol: "€",
    name: "Euro",
    rate: 0.92,
    flag: "🇪🇺",
    locale: "de-DE",
  },
  gbp: {
    code: "gbp",
    symbol: "£",
    name: "British Pound",
    rate: 0.80,
    flag: "🇬🇧",
    locale: "en-GB",
  },
  try: {
    code: "try",
    symbol: "₺",
    name: "Turkish Lira",
    rate: 34.0,
    flag: "🇹🇷",
    locale: "tr-TR",
  },
};

export function convertPrice(usdAmount: number, toCurrency: CurrencyCode): number {
  const rate = currencies[toCurrency].rate;
  return Math.round(usdAmount * rate);
}

export function formatPrice(usdAmount: number, currencyCode: CurrencyCode): string {
  const converted = convertPrice(usdAmount, currencyCode);
  const currency = currencies[currencyCode];
  return `${currency.symbol}${converted.toLocaleString()}`;
}

export function formatPriceRange(
  usdMin: number,
  usdMax: number,
  currencyCode: CurrencyCode
): string {
  const currency = currencies[currencyCode];
  const min = convertPrice(usdMin, currencyCode);
  const max = convertPrice(usdMax, currencyCode);
  return `${currency.symbol}${min.toLocaleString()}–${currency.symbol}${max.toLocaleString()}`;
}

// Budget tiers in USD (base), converted on display
export const budgetTiers = {
  starter: { min: 15, max: 25, label: "Starter" },
  budget: { min: 25, max: 50, label: "Budget" },
  mid: { min: 50, max: 100, label: "Mid-Range" },
  premium: { min: 100, max: 150, label: "Premium" },
  ultra: { min: 150, max: 300, label: "Ultra" },
};

export function getBudgetRangeLabel(
  tierId: string,
  currencyCode: CurrencyCode
): string {
  const tier = budgetTiers[tierId as keyof typeof budgetTiers];
  if (!tier) return "";
  if (tierId === "ultra") {
    return `${formatPrice(tier.min, currencyCode)}+/mo`;
  }
  return `${formatPriceRange(tier.min, tier.max, currencyCode)}/mo`;
}
