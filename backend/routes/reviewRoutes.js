import { Router } from "express";
import {
  createReview,
  getHostelReviews,
  getMyReviews,
} from "../controllers/reviewController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/", protect, authorize("student"), createReview);
router.get("/hostel/:hostelId", getHostelReviews);
router.get("/my", protect, getMyReviews);

export default router;
