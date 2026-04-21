import axios from "axios";
import * as cheerio from "cheerio";

// Global cache for scraper stats
let lastScrapeTime = null;
let lastScrapeCount = 0;

// ─── Free Proxy: allorigins.win ─────────────────────────────
// Wraps any URL to bypass CORS/IP blocking – completely free, no API key needed.
const PROXY = (url) =>
  `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

// ─── City-aware fallback demo data ──────────────────────────
function getDemoHostels(city) {
  const cityMap = {
    bangalore: [
      { name: "Wanderers Hub Backpackers", address: "142 Indiranagar 1st Stage", price: 6500, deposit: 3000, rating: 4.7, reviews: 128, type: "Budget", ac: true, wifi: true, food: false, bathroom: true, gym: false, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"], availability: 12 },
      { name: "The Student Manor", address: "88 Koramangala 4th Block", price: 9000, deposit: 5000, rating: 4.9, reviews: 210, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600"], availability: 4 },
      { name: "CoLive Tech Park", address: "Whitefield Main Road", price: 8000, deposit: 4000, rating: 4.2, reviews: 85, type: "Standard", ac: false, wifi: true, food: true, bathroom: false, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600"], availability: 18 },
    ],
    mumbai: [
      { name: "Sea Breeze PG", address: "Andheri West, Link Road", price: 11000, deposit: 6000, rating: 4.5, reviews: 97, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: false, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"], availability: 6 },
      { name: "BKC Executive Stay", address: "Bandra Kurla Complex", price: 13000, deposit: 8000, rating: 4.8, reviews: 145, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600"], availability: 2 },
    ],
    hyderabad: [
      { name: "HITEC City Scholar Residency", address: "Plot 42, Madhapur Main Road, HITEC City", price: 7500, deposit: 4000, rating: 4.6, reviews: 134, type: "Standard", ac: true, wifi: true, food: true, bathroom: true, gym: false, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"], availability: 8 },
      { name: "Gachibowli Premium PG", address: "Survey No. 15, Gachibowli Main Road, Near ISB", price: 10000, deposit: 6000, rating: 4.8, reviews: 201, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600"], availability: 5 },
      { name: "Ameerpet Student Hub", address: "Flat 3B, SR Nagar Colony, Ameerpet", price: 6000, deposit: 3000, rating: 4.2, reviews: 88, type: "Budget", ac: false, wifi: true, food: true, bathroom: false, gym: false, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600"], availability: 14 },
      { name: "Kukatpally Tech Stay", address: "KPHB Colony Phase 3, Near JNTU, Kukatpally", price: 6800, deposit: 3500, rating: 4.4, reviews: 116, type: "Standard", ac: true, wifi: true, food: false, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=600"], availability: 10 },
      { name: "Secunderabad Classic PG", address: "East Maredpally, Secunderabad", price: 5500, deposit: 2500, rating: 4.0, reviews: 64, type: "Budget", ac: false, wifi: true, food: true, bathroom: false, gym: false, laundry: false, parking: false, images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"], availability: 18 },
      { name: "Kondapur Executive Hostel", address: "Road No. 2, Kondapur, Near Cyber Towers", price: 9500, deposit: 5000, rating: 4.7, reviews: 175, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600"], availability: 3 },
      { name: "Jubilee Hills Luxury Stay", address: "Road No. 36, Jubilee Hills", price: 14000, deposit: 8000, rating: 4.9, reviews: 248, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600"], availability: 2 },
      { name: "Begumpet Scholar Inn", address: "Rajbhavan Road, Begumpet", price: 7200, deposit: 3800, rating: 4.3, reviews: 92, type: "Standard", ac: true, wifi: true, food: false, bathroom: true, gym: false, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600"], availability: 9 },
      { name: "Miyapur Budget Nest", address: "Chandanagar Main Road, Miyapur", price: 5000, deposit: 2000, rating: 3.9, reviews: 47, type: "Budget", ac: false, wifi: true, food: true, bathroom: false, gym: false, laundry: false, parking: true, images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"], availability: 22 },
      { name: "Madhapur Co-Living Space", address: "Aditya Enclave Road, Madhapur", price: 8800, deposit: 4500, rating: 4.5, reviews: 159, type: "Standard", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600"], availability: 6 },
    ],
    chennai: [
      { name: "Marina Bay PG", address: "Adyar, ECR Road", price: 7000, deposit: 3500, rating: 4.1, reviews: 54, type: "Budget", ac: false, wifi: true, food: true, bathroom: false, gym: false, laundry: true, parking: false, images: ["https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=600"], availability: 15 },
      { name: "Anna Nagar Nest", address: "Anna Nagar 2nd Street", price: 9500, deposit: 5000, rating: 4.7, reviews: 112, type: "Premium", ac: true, wifi: true, food: true, bathroom: true, gym: true, laundry: true, parking: true, images: ["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600"], availability: 3 },
    ],
  };

  const key = city.toLowerCase();
  const base = cityMap[key] || cityMap["bangalore"];

  return base.map((h) => ({
    ...h,
    city,
    cctv: true,
    powerBackup: true,
    studyRoom: Math.random() > 0.4,
    roomTypes: ["Single", "Shared"],
    totalRooms: 40 + Math.floor(Math.random() * 30),
    safety: 4.0 + Math.random(),
    source: "Web Scraper (Demo)",
  }));
}

// ─── Live scrape via allorigins.win proxy ────────────────────
async function liveScrapedResults(city) {
  const target = `https://www.hostelworld.com/st/hostels/asia/india/${encodeURIComponent(city.toLowerCase())}/`;

  const response = await axios.get(PROXY(target), {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 8000,
  });

  // allorigins returns { contents: "<html>..." }
  const html = response.data?.contents ?? "";
  if (!html) return [];

  const $ = cheerio.load(html);
  const results = [];

  // Try various selectors – hostelworld DOM varies, so we grab what we can
  const SELECTORS = [
    ".property-card",
    "[data-testid='property-card']",
    ".hw-property",
    "article",
  ];

  let found = false;
  for (const sel of SELECTORS) {
    $(sel).each((i, el) => {
      if (i >= 5) return;
      const name =
        $(el).find("h2, h3, .title, [class*='name']").first().text().trim() ||
        $(el).find("[class*='title']").first().text().trim();
      const priceText = $(el).find("[class*='price'], .price").first().text().trim();
      const ratingText = $(el).find("[class*='score'], .score, [class*='rating']").first().text().trim();

      if (name && name.length > 3) {
        found = true;
        results.push({
          name,
          address: `${city} City Center`,
          city,
          price: parseInt(priceText.replace(/[^0-9]/g, "")) || 6000,
          deposit: 3000,
          rating: parseFloat(ratingText) || 4.0,
          reviews: Math.floor(Math.random() * 100) + 20,
          type: "Standard",
          roomTypes: ["Shared", "Single"],
          ac: Math.random() > 0.4,
          wifi: true,
          food: Math.random() > 0.5,
          bathroom: Math.random() > 0.5,
          safety: 4.0 + Math.random(),
          cctv: true,
          powerBackup: Math.random() > 0.4,
          studyRoom: Math.random() > 0.5,
          gym: Math.random() > 0.6,
          laundry: Math.random() > 0.4,
          parking: Math.random() > 0.6,
          images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"],
          availability: Math.floor(Math.random() * 20) + 1,
          totalRooms: 40,
          source: "Web Scraper (Live)",
        });
      }
    });
    if (found) break;
  }

  return results;
}

// ─── Controller ──────────────────────────────────────────────
export const runScraper = async (req, res) => {
  try {
    const { city = "Bangalore" } = req.body;
    let results = [];

    console.log(`[Scraper] Attempting live scrape for city: ${city}`);

    try {
      results = await liveScrapedResults(city);
      console.log(`[Scraper] Live scrape returned ${results.length} results`);
    } catch (scrapeErr) {
      console.log("[Scraper] Live scrape failed:", scrapeErr.message);
    }

    // Always fallback to city-aware demo data if live scrape returns nothing
    if (results.length === 0) {
      results = getDemoHostels(city);
      console.log(`[Scraper] Using demo data - ${results.length} hostels for ${city}`);
    }

    lastScrapeTime = new Date().toISOString();
    lastScrapeCount = results.length;

    res.status(200).json({
      success: true,
      message: `Successfully fetched ${results.length} hostels for ${city}`,
      data: results,
      source: results[0]?.source ?? "Demo",
    });
  } catch (error) {
    console.error("[Scraper] Fatal error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to run scraper",
      error: error.message,
    });
  }
};

export const getScraperStatus = (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      lastScrapeTime,
      lastScrapeCount,
      status: "Idle",
      proxy: "allorigins.win (free, no API key needed)",
    },
  });
};
