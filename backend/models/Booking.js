import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    bookingRef: {
      type: String,
      unique: true,
    },
    // Stored directly so owner can see without populate
    studentName: { type: String, default: "" },
    studentEmail: { type: String, default: "" },
    hostelName: { type: String, default: "" },
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
    roomType: {
      type: String,
      enum: ["Single", "Shared", "Triple"],
      required: true,
    },
    checkInDate: {
      type: Date,
      required: [true, "Check-in date is required"],
    },
    checkOutDate: Date,
    monthlyRent: {
      type: Number,
      required: true,
    },
    securityDeposit: {
      type: Number,
      required: true,
    },
    platformFee: {
      type: Number,
      default: 299,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Confirmed", "Completed", "Cancelled"],
      default: "Pending",
    },
    paymentId: String,
    notes: String,
  },
  {
    timestamps: true,
  }
);

// Auto-generate booking ref before save
bookingSchema.pre("save", function (next) {
  if (!this.bookingRef) {
    this.bookingRef = "SS" + Date.now().toString().slice(-8);
  }
  if (!this.totalAmount) {
    this.totalAmount = this.monthlyRent + this.securityDeposit + this.platformFee;
  }
  next();
});

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;
