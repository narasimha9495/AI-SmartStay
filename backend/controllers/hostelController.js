import Hostel from "../models/Hostel.js";
import { asyncHandler, AppError } from "../utils/errors.js";
import { calculateDistance, recommendHostels } from "../utils/recommend.js";
import axios from "axios";

// ── Free geocoding via OpenStreetMap Nominatim ─────────────────
async function geocodeAddress(address, city) {
  try {
    const query = encodeURIComponent(`${address}, ${city}, India`);
    const res = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
      { headers: { "User-Agent": "SARP-Student-App/1.0" }, timeout: 5000 }
    );
    const data = res.data;
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch (e) {
    // Geocoding failed silently
  }
  return null;
}

// @desc    Get all active hostels (with optional distance)
// @route   GET /api/hostels
// @access  Public
export const getAllHostels = asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;
  const hostels = await Hostel.find({ active: true })
    .populate("owner", "fullName businessName")
    .sort("-rating");

  const results = await Promise.all(hostels.map(async (h) => {
    const obj = h.toObject();

    // Auto-geocode if hostel has no GPS coordinates stored
    const hasCoords =
      h.location?.coordinates?.[0] && h.location?.coordinates?.[1] &&
      h.location.coordinates[0] !== 0 && h.location.coordinates[1] !== 0;

    if (!hasCoords && h.address && h.city) {
      const geo = await geocodeAddress(h.address, h.city);
      if (geo) {
        // Save to MongoDB so we don't geocode again next time
        await Hostel.findByIdAndUpdate(h._id, {
          location: { type: "Point", coordinates: [geo.lng, geo.lat] },
        });
        obj.location = { type: "Point", coordinates: [geo.lng, geo.lat] };
      }
    }

    if (lat && lng) {
      const coordLat = obj.location?.coordinates?.[1];
      const coordLng = obj.location?.coordinates?.[0];
      if (coordLat && coordLng && coordLat !== 0 && coordLng !== 0) {
        obj.distance = calculateDistance(
          parseFloat(lat), parseFloat(lng), coordLat, coordLng
        );
      } else {
        obj.distance = null; // no coords, don't send fake distance
      }
    }
    return obj;
  }));

  // Sort by distance if lat/lng provided (use Infinity for unknowns, never 999)
  if (lat && lng) {
    results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  res.json({ success: true, count: results.length, data: results });
});

// @desc    Get hostel by ID (increments visitor count)
// @route   GET /api/hostels/:id
// @access  Public
export const getHostelById = asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;
  const hostel = await Hostel.findByIdAndUpdate(
    req.params.id,
    { $inc: { visitorCount: 1 } },
    { new: true }
  )
    .populate("owner", "fullName businessName email phone")
    .populate({
      path: "reviews",
      populate: { path: "user", select: "fullName" },
      options: { sort: { createdAt: -1 } },
    });

  if (!hostel) throw new AppError("Hostel not found", 404);

  const obj = hostel.toObject();
  if (lat && lng) {
    obj.distance = calculateDistance(
      parseFloat(lat),
      parseFloat(lng),
      hostel.location?.coordinates?.[1],
      hostel.location?.coordinates?.[0]
    );
  }

  res.json({ success: true, data: obj });
});

// @desc    Search & filter hostels
// @route   GET /api/hostels/search
// @access  Public
export const searchHostels = asyncHandler(async (req, res) => {
  const {
    query, city, maxPrice, minRating, hostelType,
    ac, wifi, food, attachedBathroom, roomType,
    lat, lng, maxDistance, sortBy,
  } = req.query;

  const filter = { active: true };

  // Text search
  if (query) {
    filter.$or = [
      { name: { $regex: query, $options: "i" } },
      { address: { $regex: query, $options: "i" } },
      { city: { $regex: query, $options: "i" } },
    ];
  }

  if (city) filter.city = { $regex: city, $options: "i" };
  if (maxPrice) filter.price = { $lte: parseFloat(maxPrice) };
  if (minRating) filter.rating = { $gte: parseFloat(minRating) };
  if (hostelType) filter.hostelType = hostelType;
  if (ac === "true") filter.ac = true;
  if (wifi === "true") filter.wifi = true;
  if (food === "true") filter.food = true;
  if (attachedBathroom === "true") filter.attachedBathroom = true;
  if (roomType) filter.roomTypes = roomType;

  let sortOption = "-rating";
  if (sortBy === "price-low") sortOption = "price";
  else if (sortBy === "price-high") sortOption = "-price";
  else if (sortBy === "rating") sortOption = "-rating";

  let hostels = await Hostel.find(filter)
    .populate("owner", "fullName businessName")
    .sort(sortOption);

  // Calculate distance and filter by maxDistance
  let results = hostels.map((h) => {
    const obj = h.toObject();
    if (lat && lng) {
      obj.distance = calculateDistance(
        parseFloat(lat),
        parseFloat(lng),
        h.location?.coordinates?.[1],
        h.location?.coordinates?.[0]
      );
    }
    return obj;
  });

  if (maxDistance && lat && lng) {
    results = results.filter((r) => r.distance <= parseFloat(maxDistance));
  }

  // Sort by distance if that's the preference
  if (!sortBy || sortBy === "distance") {
    results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  res.json({ success: true, count: results.length, data: results });
});

// @desc    AI-powered hostel recommendations
// @route   POST /api/hostels/recommend
// @access  Private (Student)
export const getRecommendations = asyncHandler(async (req, res) => {
  const hostels = await Hostel.find({ active: true, availableRooms: { $gt: 0 } })
    .populate("owner", "fullName businessName");

  const recommendations = recommendHostels(hostels, req.body);

  res.json({
    success: true,
    message: "Top 3 recommendations based on your preferences",
    data: recommendations,
  });
});

// @desc    Create new hostel
// @route   POST /api/hostels
// @access  Private (Business)
export const createHostel = asyncHandler(async (req, res) => {
  req.body.owner = req.user._id;

  // Set location from lat/lng
  if (req.body.latitude && req.body.longitude) {
    req.body.location = {
      type: "Point",
      coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)],
    };
  }

  // Map frontend hostelType → hostelType field
  if (req.body.type && !req.body.hostelType) {
    req.body.hostelType = req.body.type;
  }

  // Map individual checkbox fields  
  if (req.body.bathroom !== undefined && req.body.attachedBathroom === undefined) {
    req.body.attachedBathroom = req.body.bathroom;
  }

  // Map availability / rooms
  if (req.body.availability !== undefined && req.body.availableRooms === undefined) {
    req.body.availableRooms = req.body.availability;
  }

  const hostel = await Hostel.create(req.body);
  await hostel.populate("owner", "fullName businessName");

  res.status(201).json({
    success: true,
    message: "Hostel listing created",
    data: hostel,
  });
});

// @desc    Update hostel
// @route   PUT /api/hostels/:id
// @access  Private (Business — owner only)
export const updateHostel = asyncHandler(async (req, res) => {
  let hostel = await Hostel.findById(req.params.id);

  if (!hostel) throw new AppError("Hostel not found", 404);
  if (hostel.owner.toString() !== req.user._id.toString()) {
    throw new AppError("You can only update your own hostels", 403);
  }

  // Update location if lat/lng changed
  if (req.body.latitude && req.body.longitude) {
    req.body.location = {
      type: "Point",
      coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)],
    };
  }

  // Field mapping
  if (req.body.type && !req.body.hostelType) req.body.hostelType = req.body.type;
  if (req.body.bathroom !== undefined && req.body.attachedBathroom === undefined) {
    req.body.attachedBathroom = req.body.bathroom;
  }
  if (req.body.availability !== undefined && req.body.availableRooms === undefined) {
    req.body.availableRooms = req.body.availability;
  }

  hostel = await Hostel.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate("owner", "fullName businessName");

  res.json({ success: true, message: "Hostel updated", data: hostel });
});

// @desc    Permanently delete hostel
// @route   DELETE /api/hostels/:id
// @access  Private (Business — owner only)
export const deleteHostel = asyncHandler(async (req, res) => {
  const hostel = await Hostel.findById(req.params.id);

  if (!hostel) throw new AppError("Hostel not found", 404);
  if (hostel.owner.toString() !== req.user._id.toString()) {
    throw new AppError("You can only delete your own hostels", 403);
  }

  await Hostel.findByIdAndDelete(req.params.id);

  res.json({ success: true, message: "Hostel permanently deleted" });
});

// @desc    Get my listings (Business owner)
// @route   GET /api/hostels/my-listings
// @access  Private (Business)
export const getMyListings = asyncHandler(async (req, res) => {
  const hostels = await Hostel.find({ owner: req.user._id })
    .populate("owner", "fullName businessName")
    .sort("-createdAt");

  res.json({ success: true, count: hostels.length, data: hostels });
});
