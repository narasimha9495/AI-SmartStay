import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    hostel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hostel",
      required: true,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate reviews
reviewSchema.index({ user: 1, hostel: 1 }, { unique: true });

// Static method — recalculate hostel rating after review
reviewSchema.statics.calcAverageRating = async function (hostelId) {
  const stats = await this.aggregate([
    { $match: { hostel: hostelId } },
    {
      $group: {
        _id: "$hostel",
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ]);

  const Hostel = mongoose.model("Hostel");
  if (stats.length > 0) {
    await Hostel.findByIdAndUpdate(hostelId, {
      rating: Math.round(stats[0].avgRating * 10) / 10,
      totalReviews: stats[0].totalReviews,
    });
  } else {
    await Hostel.findByIdAndUpdate(hostelId, {
      rating: 0,
      totalReviews: 0,
    });
  }
};

// Trigger recalculation after save
reviewSchema.post("save", function () {
  this.constructor.calcAverageRating(this.hostel);
});

const Review = mongoose.model("Review", reviewSchema);
export default Review;
