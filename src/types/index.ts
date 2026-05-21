export interface Product {
  id: number;
  name: string;
  shortName?: string;
  slug: string;
  url: string;
  retailer: string;
  category: string;
  currentPrice: number;
  minPrice: number;
  maxPrice: number;
  priceCount: number;
  firstSeen: string;
  lastUpdated: string;
  imageUrl?: string;
  brand?: string;
  description?: string;
  specs?: Record<string, string>;
  matchGroup?: number | null;
  canonicalId?: number | null;
  upc?: string;
  mpn?: string;
  priceComparison?: {
    id: number;
    retailer: string;
    price: number;
    url: string;
    slug: string;
  }[];
}

export interface PricePoint {
  price: number;
  date: string;
}

/**
 * One day's aggregated price band for a BRANCH entity (a GPU chip),
 * built from all its child boards' observations. Unlike PricePoint
 * (one price), a band carries the spread: min/max bound the cheapest
 * and dearest board that day, median is the central trend.
 *
 * Used only by the chip price chart (ChipPriceChart). Leaf pages keep
 * using PricePoint. `date` is YYYY-MM-DD. `count` is how many board
 * observations went into the day (drives the "N boards" tooltip text).
 */
export interface PriceBandPoint {
  date: string;
  min: number;
  max: number;
  median: number;
  count: number;
}

export interface SiteStats {
  totalProducts: number;
  totalPricePoints: number;
  retailers: string[];
  categories: string[];
  lastUpdated: string;
  productsByRetailer: Record<string, number>;
  productsByCategory: Record<string, number>;
}

export type Category =
  | "headphones"
  | "gpus"
  | "ssds"
  | "monitors"
  | "keyboards"
  | "mice"
  | "laptops"
  | "ram"
  | "cpus"
  | "power-supplies"
  | "cases"
  | "motherboards"
  | "coolers"
  | "routers"
  | "webcams"
  | "speakers"
  | "external-storage"
  | "hard-drives"
  | "tvs"
  | "tablets"
  | "printers"
  | "gaming-consoles"
  | "smart-home"
  | "ups-power"
  | "network-switches"
  | "case-fans"
  | "desktops"
  | "nas"
  | "accessories"
  | "controllers"
  | "other";

export type Retailer = "Canada Computers" | "Newegg Canada" | "Vuugo";

export const CATEGORY_LABELS: Record<string, string> = {
  headphones: "Headphones",
  gpus: "Graphics Cards",
  ssds: "SSDs",
  "hard-drives": "Hard Drives",
  monitors: "Monitors",
  keyboards: "Keyboards",
  mice: "Mice",
  laptops: "Laptops",
  ram: "RAM",
  cpus: "CPUs",
  "power-supplies": "Power Supplies",
  cases: "PC Cases",
  motherboards: "Motherboards",
  coolers: "CPU Coolers",
  routers: "Routers",
  webcams: "Webcams",
  speakers: "Speakers",
  "external-storage": "External Storage",
  tvs: "TVs",
  tablets: "Tablets",
  printers: "Printers",
  "gaming-consoles": "Gaming Consoles",
  "smart-home": "Smart Home",
  "ups-power": "UPS & Surge Protection",
  "network-switches": "Network Switches",
  "case-fans": "Case Fans",
  desktops: "Desktop PCs",
  nas: "NAS",
  accessories: "Accessories",
  controllers: "Game Controllers",
  "lego-sets": "LEGO Sets",
  "lego-themes": "LEGO Themes",
  other: "Other",
};

export const CATEGORY_ICONS: Record<string, string> = {
  headphones: "🎧",
  gpus: "🖥️",
  ssds: "💾",
  "hard-drives": "💽",
  monitors: "🖥️",
  keyboards: "⌨️",
  mice: "🖱️",
  laptops: "💻",
  ram: "🧠",
  cpus: "⚡",
  "power-supplies": "🔌",
  cases: "🗄️",
  motherboards: "🔧",
  coolers: "❄️",
  routers: "📡",
  webcams: "📷",
  speakers: "🔊",
  "external-storage": "💿",
  tvs: "📺",
  tablets: "📱",
  printers: "🖨️",
  "gaming-consoles": "🎮",
  "smart-home": "🏠",
  "ups-power": "🔋",
  "network-switches": "🔀",
  "case-fans": "🌀",
  desktops: "🖥️",
  nas: "🗄️",
  accessories: "🧩",
  controllers: "🕹️",
  other: "📦",
};

export const RETAILER_COLORS: Record<string, string> = {
  "Canada Computers": "#e63946",
  "Newegg Canada": "#f77f00",
  "Vuugo": "#2a9d8f",
};

export const AMAZON_AFFILIATE_TAG = "trackaura00-20";
