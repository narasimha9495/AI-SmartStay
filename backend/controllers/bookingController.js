import Booking from "../models/Booking.js";
import Hostel from "../models/Hostel.js";
import { asyncHandler, AppError } from "../utils/errors.js";

// @desc    Create a booking
// @route   POST /api/bookings
// @access  Private (Student)
export const createBooking = asyncHandler(async (req, res) => {
  const { hostelId, roomType, checkInDate, checkOutDate, notes } = req.body;

  const hostel = await Hostel.findById(hostelId);
  if (!hostel) throw new AppError("Hostel not found", 404);
  if (!hostel.availableRooms || hostel.availableRooms <= 0) {
    throw new AppError("No rooms available at " + hostel.name, 400);
  }
  if (!hostel.roomTypes.includes(roomType)) {
    throw new AppError(`Room type '${roomType}' is not available`, 400);
  }

  const booking = await Booking.create({
    user: req.user._id,
    hostel: hostelId,
    roomType,
    checkInDate,
    checkOutDate,
    monthlyRent: hostel.price,
    securityDeposit: hostel.deposit,
    platformFee: 299,
    totalAmount: hostel.price + hostel.deposit + 299,
    status: "Confirmed",
    notes,
    // Store directly in MongoDB for permanent record — no populate needed
    studentName: req.user.fullName || "",
    studentEmail: req.user.email || "",
    hostelName: hostel.name || "",
  });

  // Decrement available rooms
  hostel.availableRooms -= 1;
  await hostel.save();

  await booking.populate([
    { path: "user", select: "fullName email" },
    { path: "hostel", select: "name address city" },
  ]);

  res.status(201).json({
    success: true,
    message: "Booking confirmed!",
    data: booking,
  });
});

// @desc    Get current user's bookings
// @route   GET /api/bookings/my
// @access  Private (Student)
export const getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id })
    .populate("hostel", "name address city images price")
    .sort("-createdAt");

  res.json({ success: true, count: bookings.length, data: bookings });
});

// @desc    Cancel booking
// @route   PATCH /api/bookings/my/:id/cancel
// @access  Private (Student)
export const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.user.toString() !== req.user._id.toString()) {
    throw new AppError("You can only cancel your own bookings", 403);
  }
  if (booking.status === "Completed") {
    throw new AppError("Cannot cancel a completed booking", 400);
  }

  booking.status = "Cancelled";
  await booking.save();

  // Restore room availability
  await Hostel.findByIdAndUpdate(booking.hostel, { $inc: { availableRooms: 1 } });

  await booking.populate([
    { path: "user", select: "fullName email" },
    { path: "hostel", select: "name address" },
  ]);

  res.json({ success: true, message: "Booking cancelled", data: booking });
});

// @desc    Get bookings for owner's hostels
// @route   GET /api/bookings/owner
// @access  Private (Business)
export const getOwnerBookings = asyncHandler(async (req, res) => {
  // Find all hostels owned by the user
  const ownerHostels = await Hostel.find({ owner: req.user._id }).select("_id");
  const hostelIds = ownerHostels.map((h) => h._id);

  const bookings = await Booking.find({ hostel: { $in: hostelIds } })
    .populate("user", "fullName email phone")
    .populate("hostel", "name address city")
    .sort("-createdAt");

  res.json({ success: true, count: bookings.length, data: bookings });
});

// @desc    Update booking status (Business owner)
// @route   PATCH /api/bookings/owner/:id/status
// @access  Private (Business)
export const updateBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const booking = await Booking.findById(req.params.id).populate("hostel");

  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.hostel.owner.toString() !== req.user._id.toString()) {
    throw new AppError("You can only manage bookings for your hostels", 403);
  }

  // Restore room if cancelling
  if (status === "Cancelled" && booking.status !== "Cancelled") {
    await Hostel.findByIdAndUpdate(booking.hostel._id, { $inc: { availableRooms: 1 } });
  }

  booking.status = status;
  await booking.save();

  await booking.populate([
    { path: "user", select: "fullName email" },
    { path: "hostel", select: "name address" },
  ]);

  res.json({ success: true, message: "Booking status updated", data: booking });
});

// @desc    Get booking by ID
// @route   GET /api/bookings/:id
// @access  Private
export const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("hostel", "name address city images price deposit");

  if (!booking) throw new AppError("Booking not found", 404);

  res.json({ success: true, data: booking });
});

// @desc    Get owner analytics
// @route   GET /api/dashboard/analytics
// @access  Private (Business)
export const getOwnerAnalytics = asyncHandler(async (req, res) => {
  const ownerHostels = await Hostel.find({ owner: req.user._id });
  const hostelIds = ownerHostels.map((h) => h._id);

  const totalBookings = await Booking.countDocuments({ hostel: { $in: hostelIds } });

  const revenueAgg = await Booking.aggregate([
    { $match: { hostel: { $in: hostelIds }, status: "Confirmed" } },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);
  const totalRevenue = revenueAgg.length > 0 ? revenueAgg[0].total : 0;

  const activeListings = ownerHostels.filter((h) => h.active).length;

  const avgRating =
    ownerHostels.filter((h) => h.rating > 0).reduce((sum, h) => sum + h.rating, 0) /
      (ownerHostels.filter((h) => h.rating > 0).length || 1);

  res.json({
    success: true,
    data: {
      totalBookings,
      totalRevenue,
      activeListings,
      averageRating: Math.round(avgRating * 10) / 10,
    },
  });
});
