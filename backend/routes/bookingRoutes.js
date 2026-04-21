import { Router } from "express";
import {
  createBooking,
  getMyBookings,
  cancelBooking,
  getOwnerBookings,
  updateBookingStatus,
  getBookingById,
} from "../controllers/bookingController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

// Student
router.post("/", protect, authorize("student"), createBooking);
router.get("/my", protect, authorize("student"), getMyBookings);
router.patch("/my/:id/cancel", protect, authorize("student"), cancelBooking);

// Business
router.get("/owner", protect, authorize("business"), getOwnerBookings);
router.patch("/owner/:id/status", protect, authorize("business"), updateBookingStatus);

// General
router.get("/:id", protect, getBookingById);

export default router;
