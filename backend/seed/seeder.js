import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import Hostel from "../models/Hostel.js";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";

dotenv.config();

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected for seeding");

    // Clear existing data
    await User.deleteMany({});
    await Hostel.deleteMany({});
    await Booking.deleteMany({});
    await Review.deleteMany({});
    console.log("🗑️  Cleared existing data");

    console.log("\n═══════════════════════════════════════════");
    console.log("  ✅ Database cleared successfully!");
    console.log("═══════════════════════════════════════════\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  }
};

seed();
