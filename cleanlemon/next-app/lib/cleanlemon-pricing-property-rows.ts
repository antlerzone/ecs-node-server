/** Property-type row labels (match operator Pricing page PROPERTY_ROWS). */
export const CLEANLEMON_PROPERTY_PRICING_ROWS = [
  "Studio",
  "1 bedroom",
  "2 bedroom",
  "3 bedroom",
  "4 bedroom",
  "5 bedroom",
  "Single storey",
  "Double storey",
  "Cluster",
  "Semi-D",
  "Bungalow",
  "Office 500 sqft",
  "Office 1000 sqft",
  "Office 1500 sqft",
  "Office 2000 sqft",
] as const

export type CleanlemonPropertyPricingRow = (typeof CLEANLEMON_PROPERTY_PRICING_ROWS)[number]
