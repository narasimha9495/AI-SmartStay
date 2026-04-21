import mongoose from "mongoose";

const hostelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Hostel name is required"],
      trim: true,
    },
    address: {
      type: String,
      required: [true, "Address is required"],
    },
    city: {
      type: String,
      required: [true, "City is required"],
    },
    location: {
      type: { type: String, default: "Point", enum: ["Point"] },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: 0,
    },
    deposit: {
      type: Number,
      required: [true, "Deposit is required"],
      min: 0,
    },
    hostelType: {
      type: String,
      enum: ["Premium", "Standard", "Budget"],
      required: true,
    },
    roomTypes: {
      type: [String],
      enum: ["Single", "Shared", "Triple"],
      default: ["Shared"],
    },

    // Amenities
    ac: { type: Boolean, default: false },
    wifi: { type: Boolean, default: false },
    food: { type: Boolean, default: false },
    attachedBathroom: { type: Boolean, default: false },
    gym: { type: Boolean, default: false },
    laundry: { type: Boolean, default: false },
    parking: { type: Boolean, default: false },
    cctv: { type: Boolean, default: false },
    powerBackup: { type: Boolean, default: false },
    studyRoom: { type: Boolean, default: false },

    // Ratings & Capacity
    rating: { type: Number, default: 0, min: 0, max: 5 },
    safetyRating: { type: Number, default: 5, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    totalRooms: { type: Number, default: 0 },
    availableRooms: { type: Number, default: 0 },

    // Images
    images: [String],

    description: {
      type: String,
      maxlength: 2000,
    },

    // Contact & Maps
    mapsLink: { type: String, default: "" },
    contactNumber: { type: String, default: "" },

    // Visitor tracking
    visitorCount: { type: Number, default: 0 },

    // Owner reference
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Geospatial index for location-based queries
hostelSchema.index({ location: "2dsphere" });

// Index for search
hostelSchema.index({ name: "text", address: "text", city: "text" });

// Virtual populate reviews
hostelSchema.virtual("reviews", {
  ref: "Review",
  localField: "_id",
  foreignField: "hostel",
});

// Virtual populate bookings
hostelSchema.virtual("bookings", {
  ref: "Booking",
  localField: "_id",
  foreignField: "hostel",
});

const Hostel = mongoose.model("Hostel", hostelSchema);
export default Hostel;
