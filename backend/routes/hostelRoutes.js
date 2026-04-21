import { Router } from "express";
import {
  getAllHostels,
  getHostelById,
  searchHostels,
  getRecommendations,
  createHostel,
  updateHostel,
  deleteHostel,
  getMyListings,
} from "../controllers/hostelController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

// Public
router.get("/search", searchHostels);
router.get("/", getAllHostels);

// Student only
router.post("/recommend", protect, authorize("student"), getRecommendations);

// Business only
router.get("/my-listings", protect, authorize("business"), getMyListings);
router.post("/", protect, authorize("business"), createHostel);
router.put("/:id", protect, authorize("business"), updateHostel);
router.delete("/:id", protect, authorize("business"), deleteHostel);

// Public (by ID — after other routes)
router.get("/:id", getHostelById);

export default router;
