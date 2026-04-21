import { Router } from "express";
import { getOwnerAnalytics, getOwnerBookings } from "../controllers/bookingController.js";
import { getMyListings } from "../controllers/hostelController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect, authorize("business"));

router.get("/analytics", getOwnerAnalytics);
router.get("/listings", getMyListings);
router.get("/bookings", getOwnerBookings);

export default router;
