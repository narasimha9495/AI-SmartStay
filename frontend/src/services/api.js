// ─── SmartStay API Service ─────────────────────────────────────
// Uses native fetch with JWT token from localStorage

const BASE_URL = "/api";

function getToken() {
  return localStorage.getItem("sarp_token") || "";
}

function authHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
    ...extra,
  };
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: authHeaders(),
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Request failed");
  return json;
}

// ── Auth ──────────────────────────────────────────────────────
export const loginUser = (email, password) =>
  request("POST", "/auth/login", { email, password });

export const registerUser = (data) =>
  request("POST", "/auth/register", data);

export const getMe = () =>
  request("GET", "/auth/me");

// ── Hostels ───────────────────────────────────────────────────
export const getAllHostels = (lat, lng) => {
  const params = lat && lng ? `?lat=${lat}&lng=${lng}` : "";
  return request("GET", `/hostels${params}`);
};

export const getHostelById = (id, lat, lng) => {
  const params = lat && lng ? `?lat=${lat}&lng=${lng}` : "";
  return request("GET", `/hostels/${id}${params}`);
};

export const createHostel = (data) =>
  request("POST", "/hostels", data);

export const updateHostel = (id, data) =>
  request("PUT", `/hostels/${id}`, data);

export const deleteHostel = (id) =>
  request("DELETE", `/hostels/${id}`);

export const getMyListings = () =>
  request("GET", "/hostels/my-listings");

// ── Bookings ──────────────────────────────────────────────────
export const createBooking = (data) =>
  request("POST", "/bookings", data);

export const getMyBookings = () =>
  request("GET", "/bookings/my");

export const getOwnerBookings = () =>
  request("GET", "/bookings/owner");

export const updateBookingStatus = (id, status) =>
  request("PATCH", `/bookings/owner/${id}/status`, { status });

// ── Reviews ───────────────────────────────────────────────────
export const getReviews = (hostelId) =>
  request("GET", `/reviews/hostel/${hostelId}`);

export const createReview = (data) =>
  request("POST", "/reviews", data);
