/**
 * Haversine formula — calculates distance in km between two lat/lng points.
 */
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 999;

  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * AI Recommendation Engine
 * Scores hostels across 6 dimensions (budget, room, AC, food, distance, safety)
 * Returns top 3 labeled: Best Match, Better Option, Budget Friendly
 */
export const recommendHostels = (hostels, prefs) => {
  const scored = hostels.map((h) => {
    let score = 0;

    const lat = h.location?.coordinates?.[1];
    const lng = h.location?.coordinates?.[0];
    const distance = calculateDistance(prefs.userLat, prefs.userLng, lat, lng);

    // Budget (max 30 pts)
    if (h.price <= prefs.budget) {
      score += 30;
    } else {
      score += Math.max(0, 30 - (h.price - prefs.budget) / 100);
    }

    // Room type (max 15 pts)
    if (!prefs.roomType || prefs.roomType === "any") {
      score += 15;
    } else if (h.roomTypes.includes(prefs.roomType)) {
      score += 15;
    }

    // AC (max 10 pts)
    if (prefs.acRequired && h.ac) score += 10;
    else if (!prefs.acRequired) score += 10;

    // Food (max 10 pts)
    if (prefs.foodRequired && h.food) score += 10;
    else if (!prefs.foodRequired) score += 10;

    // Distance (max 15 pts)
    const maxDist = prefs.maxDistance || 5;
    if (distance <= maxDist) {
      score += 15;
    } else {
      score += Math.max(0, 15 - (distance - maxDist) * 3);
    }

    // Safety (max 20 pts)
    const safetyWeight = (prefs.safetyImportance || 3) / 5;
    score += ((h.safetyRating || 0) / 5) * safetyWeight * 20;

    return {
      hostel: h,
      score: Math.min(Math.round(score), 100),
      distance,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const labels = ["🏆 Best Match", "⭐ Better Option", "💰 Budget Friendly"];
  return scored.slice(0, 3).map((item, i) => ({
    ...item,
    label: labels[i],
  }));
};
