import Review from "../models/Review.js";
import Hostel from "../models/Hostel.js";
import { asyncHandler, AppError } from "../utils/errors.js";

// @desc    Create a review
// @route   POST /api/reviews
// @access  Private (Student)
export const createReview = asyncHandler(async (req, res) => {
  const { hostelId, rating, comment } = req.body;

  const hostel = await Hostel.findById(hostelId);
  if (!hostel) throw new AppError("Hostel not found", 404);

  // Check duplicate
  const existing = await Review.findOne({ user: req.user._id, hostel: hostelId });
  if (existing) throw new AppError("You have already reviewed this hostel", 400);

  const review = await Review.create({
    user: req.user._id,
    hostel: hostelId,
    rating,
    comment,
  });

  await review.populate("user", "fullName");

  res.status(201).json({
    success: true,
    message: "Review submitted",
    data: review,
  });
});

// @desc    Get reviews for a hostel
// @route   GET /api/reviews/hostel/:hostelId
// @access  Public
export const getHostelReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ hostel: req.params.hostelId })
    .populate("user", "fullName")
    .sort("-createdAt");

  res.json({ success: true, count: reviews.length, data: reviews });
});

// @desc    Get current user's reviews
// @route   GET /api/reviews/my
// @access  Private
export const getMyReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user._id })
    .populate("hostel", "name city")
    .sort("-createdAt");

  res.json({ success: true, count: reviews.length, data: reviews });
});
