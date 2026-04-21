import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import errorHandler from "./middleware/errorHandler.js";

// Route imports
import authRoutes from "./routes/authRoutes.js";
import hostelRoutes from "./routes/hostelRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import scraperRoutes from "./routes/scraperRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── Connect to MongoDB ──
connectDB();

// ── Middleware ──
app.use(cors({
  origin: (origin, callback) => {
    // Allow all in development, or no-origin requests (Postman, curl, same-origin)
    if (!origin || process.env.NODE_ENV === "development") return callback(null, true);
    // Allow any vercel.app subdomain + the explicit CLIENT_URL
    const allowed = [
      process.env.CLIENT_URL,
      /^https:\/\/.*\.vercel\.app$/,
    ];
    const ok = allowed.some(p => (p instanceof RegExp ? p.test(origin) : p === origin));
    callback(ok ? null : new Error("Not allowed by CORS"), ok);
  },
  credentials: true,
}));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ── API Routes ──
app.use("/api/auth", authRoutes);
app.use("/api/hostels", hostelRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/scraper", scraperRoutes);

// ── Health Check ──
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "SmartStay API is running",
    timestamp: new Date().toISOString(),
  });
});

// ── API Docs Info ──
app.get("/api", (req, res) => {
  res.json({
    name: "SmartStay API",
    version: "1.0.0",
    description: "AI-Powered Student Hostel Finder — MERN Stack",
    endpoints: {
      auth: "/api/auth (POST /register, POST /login, GET /me)",
      hostels: "/api/hostels (GET /, GET /search, POST /recommend, POST /, PUT /:id, DELETE /:id)",
      bookings: "/api/bookings (POST /, GET /my, PATCH /my/:id/cancel, GET /owner, PATCH /owner/:id/status)",
      reviews: "/api/reviews (POST /, GET /hostel/:hostelId, GET /my)",
      dashboard: "/api/dashboard (GET /analytics, GET /listings, GET /bookings)",
    },
  });
});

// ── Error Handler ──
app.use(errorHandler);

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  🚀 SmartStay Backend running on port ${PORT}`);
  console.log(`  📡 API: http://localhost:${PORT}/api`);
  console.log(`  🔑 Auth: http://localhost:${PORT}/api/auth`);
  console.log(`  🏠 Hostels: http://localhost:${PORT}/api/hostels`);
  console.log(`═══════════════════════════════════════════\n`);
});

export default app;
