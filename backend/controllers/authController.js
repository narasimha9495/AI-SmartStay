import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import { generateToken } from "../utils/jwt.js";
import { asyncHandler, AppError } from "../utils/errors.js";


// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
export const register = asyncHandler(async (req, res) => {
  const { fullName, email, password, role, college, phone, businessName, city } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError("Email already registered", 400);
  }

  const user = await User.create({
    fullName,
    email,
    password,
    role,
    college,
    phone,
    businessName,
    city,
  });

  const token = generateToken(user._id);

  // ✅ Save signup event to MongoDB (visible in Compass → loginsessions)
  await LoginSession.create({
    user: user._id,
    email: user.email,
    role: user.role,
    ip: req.ip || req.connection?.remoteAddress || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
  });

  res.status(201).json({

    success: true,
    message: "Registration successful",
    data: {
      token,
      type: "Bearer",
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    },
  });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError("Please provide email and password", 400);
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  const token = generateToken(user._id);

  // ✅ Save login event to MongoDB (visible in Compass → loginsessions)
  await LoginSession.create({
    user: user._id,
    email: user.email,
    role: user.role,
    ip: req.ip || req.connection?.remoteAddress || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
  });

  res.json({
    success: true,
    message: "Login successful",
    data: {
      token,
      type: "Bearer",
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    },
  });
});

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
});
