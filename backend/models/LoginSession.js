import mongoose from "mongoose";

const loginSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  email: { type: String, required: true },
  role: { type: String, enum: ["student", "business"], required: true },
  loginAt: { type: Date, default: Date.now },
  userAgent: { type: String, default: "" },
  ip: { type: String, default: "" },
});

const LoginSession = mongoose.model("LoginSession", loginSessionSchema);
export default LoginSession;
