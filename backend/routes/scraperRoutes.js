import express from "express";
import { runScraper, getScraperStatus } from "../controllers/scraperController.js";

const router = express.Router();

router.post("/run", runScraper);
router.get("/status", getScraperStatus);

export default router;
