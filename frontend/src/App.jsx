import { useState, useEffect, useRef, useCallback } from "react";
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api";
import * as API from "./services/api.js";

// ─── IMAGE COMPRESSION HELPER ─────────────────────────────────
// Resizes image to max 800px and encodes as JPEG 70% — keeps Base64 small for MongoDB
function compressImage(file, maxDim = 600, quality = 0.6) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── DISTANCE HELPER (Haversine) ───────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // metres
}

// Format distance: metres when < 1km, else km
function fmtDist(metres) {
  if (metres === null || metres === undefined) return null;
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

// ─── HYDERABAD AREA COORDINATE LOOKUP ─────────────────────────
// Used when hostel has no GPS stored — matches address text to known area coords
const AREA_COORDS = {
  jodimetla:   { lat: 17.3853, lng: 78.5507 },
  narapally:   { lat: 17.4028, lng: 78.6394 },
  ghatkesar:   { lat: 17.4128, lng: 78.6959 },
  ameerpet:    { lat: 17.4338, lng: 78.4491 },
  madhapur:    { lat: 17.4487, lng: 78.3913 },
  hitec:       { lat: 17.4486, lng: 78.3908 },
  gachibowli:  { lat: 17.4401, lng: 78.3489 },
  kukatpally:  { lat: 17.4849, lng: 78.3951 },
  kphb:        { lat: 17.4849, lng: 78.3951 },
  secunderabad:{ lat: 17.4399, lng: 78.4983 },
  maredpally:  { lat: 17.4440, lng: 78.5028 },
  kondapur:    { lat: 17.4610, lng: 78.3614 },
  "jubilee hills": { lat: 17.4239, lng: 78.4077 },
  begumpet:    { lat: 17.4388, lng: 78.4729 },
  miyapur:     { lat: 17.4938, lng: 78.3548 },
  chandanagar: { lat: 17.4938, lng: 78.3548 },
  uppal:       { lat: 17.4056, lng: 78.5592 },
  dilsukhnagar:{ lat: 17.3688, lng: 78.5254 },
  lbnagar:     { lat: 17.3458, lng: 78.5484 },
  kompally:    { lat: 17.5403, lng: 78.4850 },
  nizampet:    { lat: 17.5117, lng: 78.3971 },
  bowenpally:  { lat: 17.4804, lng: 78.4804 },
  srnagar:     { lat: 17.4491, lng: 78.4291 },
  banjarahills:{ lat: 17.4126, lng: 78.4430 },
  filmcity:    { lat: 17.3850, lng: 78.4025 },
  hyderabad:   { lat: 17.3850, lng: 78.4867 }, // city centre fallback
  bangalore:   { lat: 12.9716, lng: 77.5946 },
  bengaluru:   { lat: 12.9716, lng: 77.5946 },
  mumbai:      { lat: 19.0760, lng: 72.8777 },
  chennai:     { lat: 13.0827, lng: 80.2707 },
};

function getAreaCoords(address, city) {
  const text = `${address || ""} ${city || ""}`.toLowerCase();
  for (const [key, coords] of Object.entries(AREA_COORDS)) {
    if (text.includes(key)) return coords;
  }
  return null;
}

// ─── MAP BACKEND HOSTEL → FRONTEND SHAPE ─────────────────────
function mapHostel(h) {
  if (!h) return null;
  return {
    ...h,
    id: h._id,
    type: h.hostelType || h.type || "Standard",
    bathroom: h.attachedBathroom ?? h.bathroom ?? false,
    safety: h.safetyRating ?? h.safety ?? 5,
    reviews: h.totalReviews ?? h.reviews ?? 0,
    availability: h.availableRooms ?? h.availability ?? 0,
    lat: (h.location?.coordinates?.[1] && h.location.coordinates[1] !== 0)
      ? h.location.coordinates[1]
      : (h.lat && h.lat !== 0 ? h.lat : null),
    lng: (h.location?.coordinates?.[0] && h.location.coordinates[0] !== 0)
      ? h.location.coordinates[0]
      : (h.lng && h.lng !== 0 ? h.lng : null),
    images: h.images?.length ? h.images : ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"],
    distance: (h.distance !== null && h.distance !== undefined && h.distance !== 999) ? h.distance : null,
    mapsLink: h.mapsLink || "",
    contactNumber: h.contactNumber || "",
  };
}

// ─── ICONS ────────────────────────────────────────────────────
const Icon = ({ d, size = 20, color = "currentColor", ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

const Icons = {
  search: <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
  location: <Icon d={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>} />,
  star: <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  heart: <Icon d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />,
  wifi: <Icon d={<><path d="M5 12.55a11 11 0 0114.08 0" /><path d="M1.42 9a16 16 0 0121.16 0" /><path d="M8.53 16.11a6 6 0 016.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></>} />,
  home: <Icon d={<><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>} />,
  user: <Icon d={<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>} />,
  building: <Icon d={<><rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><path d="M9 22V12h6v10" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01" /></>} />,
  chat: <Icon d={<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></>} />,
  filter: <Icon d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />,
  check: <Icon d={<><polyline points="20 6 9 17 4 12" /></>} />,
  x: <Icon d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />,
  chevRight: <Icon d={<><polyline points="9 18 15 12 9 6" /></>} />,
  chevLeft: <Icon d={<><polyline points="15 18 9 12 15 6" /></>} />,
  menu: <Icon d={<><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>} />,
  send: <Icon d={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>} />,
  calendar: <Icon d={<><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>} />,
  grid: <Icon d={<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>} />,
  trending: <Icon d={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>} />,
  shield: <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  dollar: <Icon d={<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></>} />,
  logout: <Icon d={<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>} />,
  compare: <Icon d={<><rect x="2" y="3" width="8" height="18" rx="1" /><rect x="14" y="3" width="8" height="18" rx="1" /></>} />,
  plus: <Icon d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />,
  image: <Icon d={<><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>} />,
  edit: <Icon d={<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />,
  trash: <Icon d={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></>} />,
  eye: <Icon d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>} />,
  mapPin: <Icon d={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>} />,
  bot: <Icon d={<><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16.01" /><line x1="16" y1="16" x2="16" y2="16.01" /></>} />,
  sparkle: <Icon d={<><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" /></>} />,
  crosshair: <Icon d={<><circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" /></>} />,
  scraper: <Icon d={<><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /><line x1="2" y1="12" x2="22" y2="12" /></>} />,
};

// ─── STYLES ───────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Mono:wght@400;700&display=swap');

:root {
  --pri: #0d9488;
  --pri-light: #ccfbf1;
  --pri-dark: #0f766e;
  --pri-50: #f0fdfa;
  --bg: #fafbfc;
  --card: #ffffff;
  --border: #e8ecf0;
  --text: #1a2332;
  --text2: #5a6577;
  --text3: #8c95a4;
  --danger: #ef4444;
  --warn: #f59e0b;
  --success: #10b981;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --shadow: 0 4px 16px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
  --radius: 14px;
  --radius-sm: 10px;
  --font: 'DM Sans', sans-serif;
  --mono: 'Space Mono', monospace;
}

* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
.app { min-height: 100vh; display: flex; flex-direction: column; }

@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
@keyframes dotPulse { 0%,80%,100% { transform:scale(0); } 40% { transform:scale(1); } }
@keyframes scaleIn { from { opacity:0; transform:scale(0.9); } to { opacity:1; transform:scale(1); } }
@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }

.fade-up { animation: fadeUp 0.5s ease both; }
.fade-in { animation: fadeIn 0.4s ease both; }
.scale-in { animation: scaleIn 0.3s ease both; }

.btn { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; border:none; border-radius:var(--radius-sm); font-family:var(--font); font-size:14px; font-weight:600; cursor:pointer; transition:all 0.2s ease; white-space:nowrap; }
.btn:active { transform:scale(0.97); }
.btn-pri { background:var(--pri); color:#fff; }
.btn-pri:hover { background:var(--pri-dark); box-shadow: 0 4px 14px rgba(13,148,136,0.3); }
.btn-out { background:transparent; color:var(--pri); border:1.5px solid var(--pri); }
.btn-out:hover { background:var(--pri-50); }
.btn-ghost { background:transparent; color:var(--text2); }
.btn-ghost:hover { background:#f1f5f9; color:var(--text); }
.btn-danger { background:#fef2f2; color:var(--danger); }
.btn-danger:hover { background:var(--danger); color:#fff; }
.btn-sm { padding:7px 14px; font-size:13px; }
.btn-lg { padding:14px 28px; font-size:16px; }
.btn-full { width:100%; justify-content:center; }
.btn:disabled { opacity:0.5; cursor:not-allowed; }

.input-wrap { display:flex; flex-direction:column; gap:6px; }
.input-wrap label { font-size:13px; font-weight:600; color:var(--text2); letter-spacing:0.02em; }
.input, select { width:100%; padding:11px 14px; border:1.5px solid var(--border); border-radius:var(--radius-sm); font-family:var(--font); font-size:14px; color:var(--text); background:var(--card); transition:all 0.2s ease; outline:none; }
.input:focus, select:focus { border-color:var(--pri); box-shadow:0 0 0 3px rgba(13,148,136,0.1); }
.input::placeholder { color:var(--text3); }

.card { background:var(--card); border-radius:var(--radius); border:1px solid var(--border); box-shadow:var(--shadow-sm); transition:all 0.25s ease; }
.card:hover { box-shadow:var(--shadow); }
.card-elevated { box-shadow:var(--shadow); }
.card-elevated:hover { box-shadow:var(--shadow-lg); transform:translateY(-2px); }

.badge { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600; }
.badge-pri { background:var(--pri-light); color:var(--pri-dark); }
.badge-success { background:#ecfdf5; color:#059669; }
.badge-warn { background:#fffbeb; color:#d97706; }
.badge-danger { background:#fef2f2; color:#dc2626; }

.nav { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; background:rgba(255,255,255,0.85); backdrop-filter:blur(16px); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100; }
.nav-logo { font-family:var(--mono); font-weight:700; font-size:20px; color:var(--pri); letter-spacing:-0.5px; display:flex; align-items:center; gap:8px; cursor:pointer; text-decoration:none; }
.nav-logo span { color:var(--text); }
.nav-links { display:flex; align-items:center; gap:6px; }
.nav-link { padding:8px 16px; border-radius:var(--radius-sm); font-size:14px; font-weight:500; color:var(--text2); cursor:pointer; transition:all 0.2s; border:none; background:none; font-family:var(--font); }
.nav-link:hover { color:var(--pri); background:var(--pri-50); }
.nav-link.active { color:var(--pri); background:var(--pri-light); }

.hostel-card { overflow:hidden; cursor:pointer; }
.hostel-card-img { width:100%; height:200px; object-fit:cover; transition:transform 0.4s ease; }
.hostel-card:hover .hostel-card-img { transform:scale(1.05); }
.hostel-card-body { padding:16px; }
.hostel-card-top { display:flex; justify-content:space-between; align-items:start; margin-bottom:8px; }
.hostel-card-name { font-size:17px; font-weight:700; color:var(--text); }
.hostel-card-addr { font-size:13px; color:var(--text3); margin-bottom:10px; }
.hostel-card-tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
.hostel-card-price { display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid var(--border); }
.hostel-card-price strong { font-size:20px; color:var(--pri); font-family:var(--mono); }
.hostel-card-price span { font-size:13px; color:var(--text3); }

.section { padding:32px 24px; max-width:1280px; margin:0 auto; width:100%; }
.section-title { font-size:24px; font-weight:700; margin-bottom:6px; }
.section-sub { font-size:15px; color:var(--text2); margin-bottom:24px; }
.grid-3 { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; }
.grid-2 { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
.grid-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }

.chat-fab { position:fixed; bottom:24px; right:24px; width:56px; height:56px; border-radius:50%; background:var(--pri); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 24px rgba(13,148,136,0.35); transition:all 0.2s; z-index:200; border:none; }
.chat-fab:hover { transform:scale(1.08); box-shadow:0 8px 32px rgba(13,148,136,0.45); }
.chat-panel { position:fixed; bottom:90px; right:24px; width:380px; max-height:520px; background:var(--card); border-radius:var(--radius); box-shadow:var(--shadow-lg); border:1px solid var(--border); display:flex; flex-direction:column; z-index:200; animation:scaleIn 0.25s ease; overflow:hidden; }
.chat-header { padding:16px; background:var(--pri); color:#fff; display:flex; align-items:center; gap:10px; }
.chat-header h3 { font-size:15px; font-weight:600; }
.chat-header p { font-size:12px; opacity:0.8; }
.chat-body { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; max-height:360px; }
.chat-msg { max-width:85%; padding:10px 14px; border-radius:14px; font-size:14px; line-height:1.5; animation:fadeUp 0.3s ease; }
.chat-msg.bot { background:var(--pri-50); color:var(--text); align-self:flex-start; border-bottom-left-radius:4px; }
.chat-msg.user { background:var(--pri); color:#fff; align-self:flex-end; border-bottom-right-radius:4px; }
.chat-input-row { display:flex; gap:8px; padding:12px; border-top:1px solid var(--border); }
.chat-input-row input { flex:1; }
.chat-typing { display:flex; gap:4px; padding:10px 14px; align-self:flex-start; }
.chat-typing span { width:8px; height:8px; background:var(--pri); border-radius:50%; animation:dotPulse 1.4s infinite ease-in-out both; }
.chat-typing span:nth-child(1) { animation-delay:-0.32s; }
.chat-typing span:nth-child(2) { animation-delay:-0.16s; }

.hero { min-height:88vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:60px 24px; background:linear-gradient(165deg, #f0fdfa 0%, #fafbfc 40%, #fff 100%); position:relative; overflow:hidden; }
.hero::before { content:''; position:absolute; top:-200px; right:-200px; width:600px; height:600px; background:radial-gradient(circle, rgba(13,148,136,0.06) 0%, transparent 70%); border-radius:50%; }
.hero::after { content:''; position:absolute; bottom:-150px; left:-150px; width:400px; height:400px; background:radial-gradient(circle, rgba(13,148,136,0.04) 0%, transparent 70%); border-radius:50%; }
.hero h1 { font-size:clamp(36px,5vw,56px); font-weight:700; line-height:1.15; max-width:680px; letter-spacing:-1px; margin-bottom:16px; position:relative; }
.hero h1 em { font-style:normal; color:var(--pri); }
.hero p { font-size:18px; color:var(--text2); max-width:520px; line-height:1.6; margin-bottom:36px; position:relative; }
.hero-btns { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; position:relative; }
.hero-features { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; max-width:900px; margin-top:64px; position:relative; }
.hero-feat { display:flex; align-items:center; gap:12px; padding:16px 20px; background:rgba(255,255,255,0.8); backdrop-filter:blur(8px); border-radius:var(--radius-sm); border:1px solid var(--border); }
.hero-feat-icon { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:var(--pri-light); color:var(--pri); flex-shrink:0; }
.hero-feat h4 { font-size:14px; font-weight:600; }
.hero-feat p { font-size:12px; color:var(--text3); margin:0; }

.auth-container { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bg); }
.auth-card { width:100%; max-width:420px; padding:40px; }
.auth-card h2 { font-size:24px; font-weight:700; margin-bottom:6px; text-align:center; }
.auth-card p { font-size:14px; color:var(--text2); text-align:center; margin-bottom:28px; }
.auth-card .input-wrap { margin-bottom:16px; }
.auth-toggle { text-align:center; margin-top:20px; font-size:14px; color:var(--text2); }
.auth-toggle a { color:var(--pri); cursor:pointer; font-weight:600; text-decoration:none; }
.auth-toggle a:hover { text-decoration:underline; }

.filter-bar { padding:20px; background:var(--card); border-radius:var(--radius); border:1px solid var(--border); }
.filter-group { margin-bottom:20px; }
.filter-group h4 { font-size:13px; font-weight:700; color:var(--text2); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px; }
.filter-check { display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer; font-size:14px; color:var(--text); }
.filter-check input[type=checkbox] { accent-color:var(--pri); width:16px; height:16px; }
.range-val { display:flex; justify-content:space-between; font-size:13px; color:var(--text3); margin-top:4px; }
input[type=range] { width:100%; accent-color:var(--pri); }

.detail-hero { width:100%; height:340px; background:#e8ecf0; border-radius:var(--radius); overflow:hidden; position:relative; }
.detail-hero img { width:100%; height:100%; object-fit:cover; }
.detail-gallery { display:flex; gap:8px; margin-top:8px; }
.detail-gallery img { width:80px; height:60px; border-radius:8px; object-fit:cover; cursor:pointer; border:2px solid transparent; transition:all 0.2s; }
.detail-gallery img:hover, .detail-gallery img.active { border-color:var(--pri); }
.detail-info { display:grid; grid-template-columns:1fr 340px; gap:24px; margin-top:24px; }
.amenity-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; margin-top:12px; }
.amenity-item { display:flex; align-items:center; gap:8px; padding:10px 14px; border-radius:var(--radius-sm); background:var(--pri-50); font-size:13px; font-weight:500; color:var(--pri-dark); }
.amenity-item.no { background:#f9fafb; color:var(--text3); text-decoration:line-through; }

.checkout-card { padding:24px; position:sticky; top:90px; }
.checkout-row { display:flex; justify-content:space-between; padding:10px 0; font-size:14px; }
.checkout-row.total { border-top:2px solid var(--border); font-weight:700; font-size:16px; margin-top:8px; padding-top:14px; }
.checkout-row.total span:last-child { color:var(--pri); font-family:var(--mono); }

.compare-table { width:100%; overflow-x:auto; }
.compare-table table { width:100%; border-collapse:collapse; min-width:600px; }
.compare-table th { padding:12px 16px; text-align:left; font-size:13px; font-weight:600; color:var(--text2); background:#f8fafc; border-bottom:1px solid var(--border); }
.compare-table td { padding:12px 16px; font-size:14px; border-bottom:1px solid var(--border); }
.compare-table tr:hover td { background:var(--pri-50); }

.dash-layout { display:grid; grid-template-columns:240px 1fr; min-height:100vh; }
.dash-sidebar { background:var(--card); border-right:1px solid var(--border); padding:20px 0; }
.dash-sidebar-item { display:flex; align-items:center; gap:10px; padding:11px 24px; font-size:14px; font-weight:500; color:var(--text2); cursor:pointer; transition:all 0.2s; border:none; background:none; width:100%; font-family:var(--font); text-align:left; }
.dash-sidebar-item:hover { background:var(--pri-50); color:var(--pri); }
.dash-sidebar-item.active { background:var(--pri-light); color:var(--pri-dark); border-right:3px solid var(--pri); }
.dash-main { padding:28px; background:var(--bg); overflow-y:auto; }
.stat-card { padding:20px; display:flex; flex-direction:column; gap:8px; }
.stat-card h4 { font-size:13px; font-weight:600; color:var(--text3); }
.stat-card .val { font-size:28px; font-weight:700; font-family:var(--mono); color:var(--text); }
.stat-card .change { font-size:13px; font-weight:600; }

.confirm-anim { width:80px; height:80px; border-radius:50%; background:var(--success); display:flex; align-items:center; justify-content:center; margin:0 auto 20px; animation:scaleIn 0.4s ease; }

.map-placeholder { width:100%; height:200px; background:linear-gradient(135deg,#e0f2fe,#ccfbf1); border-radius:var(--radius); display:flex; align-items:center; justify-content:center; color:var(--pri); font-weight:600; font-size:14px; position:relative; overflow:hidden; }
.map-dot { width:12px; height:12px; background:var(--pri); border-radius:50%; animation:pulse 2s infinite; box-shadow:0 0 0 4px rgba(13,148,136,0.2); }

.review-card { padding:16px; margin-bottom:10px; }
.review-header { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.review-avatar { width:36px; height:36px; border-radius:50%; background:var(--pri-light); display:flex; align-items:center; justify-content:center; color:var(--pri); font-weight:700; font-size:14px; }

.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); backdrop-filter:blur(4px); z-index:300; display:flex; align-items:center; justify-content:center; padding:24px; animation:fadeIn 0.2s ease; }
.modal { background:var(--card); border-radius:var(--radius); max-width:560px; width:100%; max-height:80vh; overflow-y:auto; animation:scaleIn 0.25s ease; }
.modal-header { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1px solid var(--border); }
.modal-header h3 { font-size:18px; font-weight:700; }
.modal-body { padding:24px; }

.tabs { display:flex; gap:4px; padding:4px; background:#f1f5f9; border-radius:var(--radius-sm); margin-bottom:20px; }
.tab { flex:1; padding:9px 16px; text-align:center; font-size:14px; font-weight:600; border-radius:8px; cursor:pointer; transition:all 0.2s; border:none; background:none; font-family:var(--font); color:var(--text2); }
.tab.active { background:var(--card); color:var(--text); box-shadow:var(--shadow-sm); }

.loc-status { display:flex; align-items:center; gap:8px; padding:10px 16px; border-radius:var(--radius-sm); font-size:13px; font-weight:500; }
.loc-status.detecting { background:#fef3c7; color:#92400e; }
.loc-status.success { background:#ecfdf5; color:#065f46; }
.loc-status.error { background:#fef2f2; color:#991b1b; }
.loc-spinner { width:16px; height:16px; border:2px solid #d97706; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; }

@media (max-width:900px) {
  .grid-3 { grid-template-columns:1fr; }
  .grid-4 { grid-template-columns:repeat(2,1fr); }
  .detail-info { grid-template-columns:1fr; }
  .dash-layout { grid-template-columns:1fr; }
  .dash-sidebar { display:none; }
  .nav-links { display:none; }
  .hero h1 { font-size:32px; }
  .chat-panel { width:calc(100vw - 32px); right:16px; bottom:80px; }
  .hero-features { grid-template-columns:1fr; }
}

::-webkit-scrollbar { width:6px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:3px; }
::-webkit-scrollbar-thumb:hover { background:#9ca3af; }
`;

// ─── LOCAL AI ENGINE — NO API KEY NEEDED ─────────────────────
// Keyword maps for understanding natural language input
const INTENT_MAP = {
  budget: ["cheap", "budget", "affordable", "low cost", "less", "under", "below", "inexpensive", "minimum", "economic", "tight", "₹", "rs", "rupee"],
  premium: ["premium", "luxury", "best", "top", "high end", "fancy", "elite", "expensive", "quality"],
  ac: ["ac", "air condition", "air-condition", "cool", "cooling", "aircon", "a/c"],
  food: ["food", "meal", "meals", "breakfast", "dinner", "lunch", "eat", "eating", "tiffin", "mess", "kitchen", "cook"],
  gym: ["gym", "workout", "fitness", "exercise", "weights", "training"],
  wifi: ["wifi", "wi-fi", "internet", "net", "connection", "online"],
  bathroom: ["bathroom", "attached", "private bath", "bath", "toilet", "washroom"],
  laundry: ["laundry", "wash clothes", "washing", "laundry service"],
  parking: ["parking", "bike", "car", "vehicle", "scooter"],
  cctv: ["cctv", "security", "safe", "camera", "surveillance", "secure"],
  studyRoom: ["study", "study room", "quiet", "library", "read", "reading"],
  powerBackup: ["power backup", "power cut", "electricity", "backup", "inverter", "ups"],
  single: ["single", "alone", "private room", "own room", "by myself"],
  shared: ["shared", "sharing", "roommate", "double", "buddy", "together"],
  triple: ["triple", "three", "3 people", "3-sharing"],
  near: ["near", "nearby", "close", "walking distance", "km", "distance", "proximity"],
  rating: ["good rating", "highly rated", "top rated", "best rated", "4 star", "5 star", "rating", "reviews", "reviewed"],
  safety: ["safe", "safety", "secure", "security", "women", "girls", "female", "ladies"],
};

function extractIntent(msg) {
  const lower = msg.toLowerCase();
  const intent = {};

  // Budget extraction — find numbers near budget keywords
  const budgetMatch = lower.match(/(?:under|below|less than|upto|up to|within|max|₹|rs\.?)\s*(\d{3,5})/i)
    || lower.match(/(\d{3,5})\s*(?:rupees?|rs\.?|₹|per month|\/month|\/mo|month)/i)
    || lower.match(/(\d{4,5})/);
  if (budgetMatch) intent.budget = parseInt(budgetMatch[1]);

  // Distance extraction
  const distMatch = lower.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (distMatch) intent.maxDist = parseFloat(distMatch[1]);

  // Amenity flags
  for (const [key, keywords] of Object.entries(INTENT_MAP)) {
    if (["budget", "premium", "near", "rating", "safety"].includes(key)) continue;
    if (keywords.some(k => lower.includes(k))) intent[key] = true;
  }

  // Room type
  if (INTENT_MAP.single.some(k => lower.includes(k))) intent.roomType = "Single";
  else if (INTENT_MAP.triple.some(k => lower.includes(k))) intent.roomType = "Triple";
  else if (INTENT_MAP.shared.some(k => lower.includes(k))) intent.roomType = "Shared";

  // Quality preference
  if (INTENT_MAP.premium.some(k => lower.includes(k))) intent.wantsPremium = true;
  if (INTENT_MAP.budget.some(k => lower.includes(k)) && !intent.budget) intent.wantsBudget = true;

  // Safety / women specific
  if (INTENT_MAP.safety.some(k => lower.includes(k))) intent.wantsSafety = true;

  // Rating preference
  if (INTENT_MAP.rating.some(k => lower.includes(k))) intent.wantsHighRating = true;

  return intent;
}

function scoreHostel(h, intent) {
  let score = 0;
  const reasons = [];

  // Budget fit — most important factor
  if (intent.budget) {
    if (h.price <= intent.budget) {
      score += 40;
      reasons.push(`within your ₹${intent.budget} budget`);
    } else {
      const over = h.price - intent.budget;
      score += Math.max(0, 40 - Math.floor(over / 100) * 3);
    }
  } else if (intent.wantsPremium) {
    if (h.type === "Premium") { score += 35; reasons.push("premium tier"); }
    else if (h.type === "Standard") score += 20;
    else score += 5;
  } else if (intent.wantsBudget) {
    if (h.type === "Budget") { score += 35; reasons.push("budget-friendly"); }
    else if (h.type === "Standard") score += 20;
    else score += 5;
  } else {
    score += 20; // neutral
  }

  // Distance fit
  if (intent.maxDist) {
    if (h.distance !== null && (h.distance / 1000) <= intent.maxDist) { score += 20; reasons.push(`only ${(h.distance/1000).toFixed(1)}km away`); }
    else if (h.distance !== null) score += Math.max(0, 20 - ((h.distance/1000) - intent.maxDist) * 4);
  } else {
    // Closer is always better when no preference given
    if (h.distance !== null) score += Math.max(0, 15 - (h.distance/1000) * 2);
  }

  // Amenity matching — 8 pts each
  const amenityChecks = [
    { key: "ac", field: "ac", label: "AC" },
    { key: "food", field: "food", label: "meals included" },
    { key: "gym", field: "gym", label: "gym" },
    { key: "wifi", field: "wifi", label: "WiFi" },
    { key: "bathroom", field: "bathroom", label: "attached bathroom" },
    { key: "laundry", field: "laundry", label: "laundry" },
    { key: "parking", field: "parking", label: "parking" },
    { key: "cctv", field: "cctv", label: "CCTV security" },
    { key: "studyRoom", field: "studyRoom", label: "study room" },
    { key: "powerBackup", field: "powerBackup", label: "power backup" },
  ];
  for (const a of amenityChecks) {
    if (intent[a.key]) {
      if (h[a.field]) { score += 8; reasons.push(a.label); }
      else score -= 10;
    }
  }

  // Room type match — 15 pts
  if (intent.roomType) {
    if (h.roomTypes.includes(intent.roomType)) { score += 15; reasons.push(`${intent.roomType} room available`); }
    else score -= 8;
  }

  // Safety preference
  if (intent.wantsSafety) {
    score += h.safety * 3;
    if (h.safety >= 4.5) reasons.push(`high safety score ${h.safety}/5`);
  }

  // Rating preference
  if (intent.wantsHighRating) {
    score += h.rating * 3;
    if (h.rating >= 4.5) reasons.push(`top rated ${h.rating}⭐`);
  }

  // Availability bonus
  if (h.availability > 0) score += 5;
  if (h.availability === 0) score -= 50;

  return { score: Math.round(score), reasons };
}

// ─── BOT HELPERS ──────────────────────────────────────────────
// Build a natural sentence describing what a hostel offers
function describeAmenities(h) {
  const parts = [];
  if (h.ac) parts.push("air-conditioned rooms");
  if (h.bathroom) parts.push("attached private bathrooms");
  if (h.wifi) parts.push("high-speed WiFi");
  if (h.food) parts.push("daily meals included (breakfast & dinner)");
  if (h.gym) parts.push("an in-house gym");
  if (h.studyRoom) parts.push("a dedicated study room");
  if (h.laundry) parts.push("laundry service");
  if (h.parking) parts.push("vehicle parking");
  if (h.cctv) parts.push("24/7 CCTV surveillance");
  if (h.powerBackup) parts.push("power backup");
  if (parts.length === 0) return "basic accommodation facilities.";
  if (parts.length === 1) return parts[0] + ".";
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1] + ".";
}

function shortAmenities(h) {
  const tags = [];
  if (h.ac) tags.push("AC");
  if (h.wifi) tags.push("WiFi");
  if (h.food) tags.push("Meals");
  if (h.bathroom) tags.push("Attached Bath");
  if (h.gym) tags.push("Gym");
  if (h.laundry) tags.push("Laundry");
  if (h.cctv) tags.push("CCTV");
  if (h.powerBackup) tags.push("Power Backup");
  if (h.studyRoom) tags.push("Study Room");
  if (h.parking) tags.push("Parking");
  return tags.length ? tags.join(" • ") : "Basic amenities";
}

function buildLocalReply(msg, hostels, userLoc, conversationHistory) {
  const lower = msg.toLowerCase();

  // ── Greetings ──
  const greetWords = ["hi", "hello", "hey", "hii", "helo", "good morning", "good evening", "good afternoon", "sup", "yo", "namaste"];
  if (greetWords.some(g => lower.trim().startsWith(g)) && lower.length < 30) {
    return {
      text: `Hey there! 👋 I'm **SARP AI**, your personal accommodation assistant.\n\nI know all ${hostels.length} verified hostels on this platform — just tell me:\n• Your monthly budget (e.g. under ₹7,000)\n• Amenities you need (AC, meals, gym, WiFi, etc.)\n• Room preference (single / shared / triple)\n\nI'll describe the best options for you! 🏠`,
      hostelId: null,
    };
  }

  // ── Thanks / bye ──
  if (["thank", "thanks", "ok thanks", "great", "awesome", "perfect", "bye", "goodbye"].some(w => lower.includes(w)) && lower.length < 25) {
    return {
      text: "You're welcome! 😊 Feel free to ask anytime — I'm here to help you find the perfect place to stay. Good luck! 🍀",
      hostelId: null,
    };
  }

  // ── Show all hostels ──
  if (lower.includes("show all") || lower.includes("all hostel") || lower.includes("list all") || lower.includes("all pg") || lower.includes("what hostel") || lower.includes("available hostel") || lower.includes("all available")) {
    let reply = `Here are all **${hostels.length} verified hostels** available on SARP:\n\n`;
    hostels.forEach((h, i) => {
      reply += `**${i + 1}. ${h.name}** — ₹${h.price.toLocaleString()}/month\n`;
      reply += `   🏠 ${h.type} | ${h.roomTypes.join(" / ")} rooms | ⭐${h.rating}\n`;
      reply += `   ✅ Offers: ${shortAmenities(h)}\n\n`;
    });
    reply += "Ask me about any one of these and I'll describe them in detail!";
    return { text: reply, hostelId: null };
  }

  // ── Details about a specific named hostel ──
  const namedHostel = hostels.find(h =>
    lower.includes(h.name.toLowerCase()) ||
    h.name.toLowerCase().split(" ").some(word => word.length > 3 && lower.includes(word.toLowerCase()))
  );
  if (namedHostel && (lower.includes("detail") || lower.includes("tell me") || lower.includes("about") || lower.includes("more") || lower.includes("info") || lower.includes("price") || lower.includes("cost") || lower.includes("amenity") || lower.includes("facilities") || lower.includes("feature"))) {
    const h = namedHostel;
    const amenDesc = describeAmenities(h);
    return {
      text: `Here's everything about **${h.name}** 🏠\n\n` +
        `**Type:** ${h.type} hostel\n` +
        `**Room options:** ${h.roomTypes.join(", ")}\n` +
        `**Rent:** ₹${h.price.toLocaleString()}/month | Security deposit: ₹${h.deposit.toLocaleString()}\n` +
        `**Rating:** ⭐ ${h.rating}/5 (${h.reviews} reviews) | 🛡️ Safety: ${h.safety}/5\n` +
        `**Rooms available:** ${h.availability}\n\n` +
        `**What this hostel offers:**\n${h.name} provides ${amenDesc}\n\n` +
        `Would you like to book this hostel or compare it with another?`,
      hostelId: h.id,
    };
  }

  // ── Main recommendation engine ──
  const intent = extractIntent(msg);
  const hasIntent = Object.keys(intent).length > 0;

  if (!hasIntent) {
    return {
      text: "I'd love to help you find the right student accommodation! 🏠\n\nCould you describe what you're looking for?\n• **Budget** — e.g. under ₹7,000/month\n• **Amenities** — AC, meals, gym, WiFi, laundry, etc.\n• **Room type** — single, shared, or triple\n\nJust say something like *\"I need AC and food under ₹8,000\"* and I'll find the best match!",
      hostelId: null,
    };
  }

  // Score all hostels
  const scored = hostels.map(h => {
    const { score, reasons } = scoreHostel(h, intent);
    return { ...h, score, reasons };
  }).sort((a, b) => b.score - a.score);

  // Hard-exclude hostels that are MISSING a specifically requested amenity
  const AMENITY_KEYS = ["ac", "food", "gym", "wifi", "bathroom", "laundry", "parking", "cctv", "studyRoom", "powerBackup"];
  const qualified = scored.filter(h => {
    for (const key of AMENITY_KEYS) {
      if (intent[key] && !h[key]) return false; // user asked for it, hostel doesn't have it
    }
    if (intent.roomType && !h.roomTypes.includes(intent.roomType)) return false;
    return h.score > 0;
  });

  const top = qualified.slice(0, 3);

  if (top.length === 0) {
    // Fall back to top scored regardless of amenity strict match, with a note
    const relaxed = scored.filter(h => h.score > 0).slice(0, 3);
    if (relaxed.length === 0) {
      return {
        text: "Hmm, I couldn't find a hostel that perfectly matches all of that from our current listings. 😕\n\nOr just ask me to **show all hostels** and I'll list everything available!",
        hostelId: null,
      };
    }
    return {
      text: `I couldn't find a hostel with **exactly** those facilities, but here are the closest options:\n\n` +
        relaxed.map((h, i) => {
          const amenDesc = describeAmenities(h);
          return `${i + 1}. **${h.name}** — ₹${h.price.toLocaleString()}/month\n   ✅ Offers: ${amenDesc}`;
        }).join("\n\n") +
        "\n\nWant details on any of these?",
      hostelId: relaxed[0].id || relaxed[0]._id,
    };
  }

  // ── Build descriptive response ──
  const best = top[0];

  if (top.length === 1) {
    const amenDesc = describeAmenities(best);
    let reply = `Based on what you need, **${best.name}** is your best match! 🏆\n\n`;
    reply += `**${best.type}** hostel | **${best.roomTypes.join(" / ")}** rooms\n`;
    reply += `💰 **₹${best.price.toLocaleString()}/month** | ⭐ ${best.rating}/5 rating\n`;
    reply += `🛏️ **${best.availability} rooms** currently available\n\n`;
    reply += `**What it offers:** ${best.name} provides ${amenDesc}\n\n`;
    reply += `Want to view full details or shall I compare it with other options?`;
    return { text: reply, hostelId: best.id };
  }

  let reply = "Here are my top picks based on what you need:\n\n";
  const labels = ["🏆 Best Match", "⭐ Runner Up", "💡 Also Great"];
  top.forEach((h, i) => {
    const amenDesc = describeAmenities(h);
    reply += `${labels[i]}: **${h.name}**\n`;
    reply += `   💰 ₹${h.price.toLocaleString()}/month | ⭐ ${h.rating}/5 | ${h.type}\n`;
    reply += `   🏠 ${h.roomTypes.join(" / ")} rooms | ${h.availability} rooms left\n`;
    reply += `   ✅ Offers: ${amenDesc}\n\n`;
  });

  if (intent.budget && best.price <= intent.budget) {
    reply += `I'd especially recommend **${best.name}** — it fits within your ₹${intent.budget.toLocaleString()} budget and offers great facilities.`;
  } else if (intent.wantsSafety) {
    const safest = top.reduce((a, b) => a.safety > b.safety ? a : b);
    reply += `For maximum safety, **${safest.name}** scores highest at ${safest.safety}/5 — a great choice for secure living.`;
  } else {
    reply += `**${best.name}** scores highest overall based on your requirements.`;
  }
  reply += "\n\nAsk me about any of these for more details!";
  return { text: reply, hostelId: best.id };
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
    const data = await res.json();
    const addr = data.address || {};
    const road = addr.road || addr.neighbourhood || addr.suburb || "";
    const area = addr.suburb || addr.neighbourhood || addr.county || "";
    const city = addr.city || addr.town || addr.state_district || addr.state || "Bangalore";
    const displayAddr = [road, area].filter(Boolean).join(", ") || data.display_name?.split(",").slice(0, 3).join(",") || "";
    return { address: displayAddr, city };
  } catch {
    return { address: "", city: "Bangalore" };
  }
}

// ─── SHARED SUB-COMPONENTS ────────────────────────────────────
function Stars({ rating, size = 14 }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= Math.round(rating) ? "#f59e0b" : "#e5e7eb"} stroke="none">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

function NavLogo({ onClick }) {
  return (
    <div className="nav-logo" onClick={onClick} style={{ gap: 10, alignItems: "center" }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 17, color: "var(--pri)", letterSpacing: "-0.3px" }}>SARP</span>
        <span style={{ fontFamily: "var(--font)", fontWeight: 500, fontSize: 9, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Accommodation Platform</span>
      </div>
    </div>
  );
}

// ─── PAGE: LANDING ────────────────────────────────────────────
function LandingPage({ setPage, setUserType, setAuthMode }) {
  return (
    <div className="fade-in">
      <nav className="nav">
        <NavLogo onClick={() => setPage("landing")} />
        <div className="nav-links">
          <button className="btn btn-ghost btn-sm" onClick={() => { setUserType("student"); setAuthMode("signup"); setPage("auth"); }}>Student Login</button>
          <button className="btn btn-out btn-sm" onClick={() => { setUserType("business"); setAuthMode("signup"); setPage("auth"); }}>Business Login</button>
        </div>
      </nav>
      <div className="hero">
        <h1 className="fade-up">Smart <em>Accommodation</em><br />Recommendation Platform</h1>
        <p className="fade-up" style={{ animationDelay: "0.1s" }}>AI-powered student accommodation discovery that matches you with verified hostels based on your location, budget, and lifestyle — built for students, by design.</p>
        <div className="hero-btns fade-up" style={{ animationDelay: "0.2s" }}>
          <button className="btn btn-pri btn-lg" onClick={() => { setUserType("student"); setPage("auth"); }}>{Icons.search} Find Accommodation</button>
          <button className="btn btn-out btn-lg" onClick={() => { setUserType("business"); setPage("auth"); }}>{Icons.building} List Your Hostel</button>
        </div>
        <div className="hero-features fade-up" style={{ animationDelay: "0.35s" }}>
          {[
            { icon: Icons.mapPin, title: "Live Location", desc: "Auto-detect & distance ranking" },
            { icon: Icons.bot, title: "AI Assistant", desc: "AI-powered accommodation matching" },
            { icon: Icons.shield, title: "Verified Hostels", desc: "Safety rated & reviewed" },
            { icon: Icons.compare, title: "Compare Side-by-Side", desc: "Multi-hostel comparison" },
          ].map((f, i) => (
            <div key={i} className="hero-feat">
              <div className="hero-feat-icon">{f.icon}</div>
              <div><h4>{f.title}</h4><p>{f.desc}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: AUTH ───────────────────────────────────────────────
function AuthPage({ userType, authMode, setAuthMode, setPage, onLogin }) {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", college: "", businessName: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const upd = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErr(""); };

  // Silent validation — button disabled if invalid, no popups
  const emailOk = form.email.includes("@") && form.email.includes(".");
  const passOk = form.password.length >= 6;
  const nameOk = authMode === "login" || form.fullName.trim().length >= 2;
  const canSubmit = emailOk && passOk && nameOk && !loading;

  const switchMode = (mode) => { setAuthMode(mode); setErr(""); setForm(f => ({ ...f, password: "" })); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(""); setLoading(true);
    try {
      let res;
      if (authMode === "login") {
        res = await API.loginUser(form.email, form.password);
      } else {
        res = await API.registerUser({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          role: userType === "business" ? "business" : "student",
          college: form.college || undefined,
          businessName: form.businessName || undefined,
        });
      }
      localStorage.setItem("sarp_token", res.data.token);
      onLogin(res.data.user);
    } catch (e) {
      // Show only clean API error — no browser popups, no alerts
      setErr(e.message === "Failed to fetch"
        ? "Cannot connect to server. Please make sure the backend is running."
        : (e.message || "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container fade-in">
      <div className="auth-card card card-elevated">
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div className="nav-logo" style={{ justifyContent: "center", marginBottom: 16, cursor: "pointer" }} onClick={() => setPage("landing")}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span style={{ color: "var(--pri)", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 20 }}>SARP</span>
          </div>
        </div>
        <h2 style={{ marginBottom: 4 }}>{authMode === "login" ? "Welcome Back" : "Create Account"}</h2>
        <p style={{ marginBottom: 20 }}>{userType === "student" ? "Student Portal — SARP" : "Business Portal — SARP"}</p>

        {err && (
          <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm)", color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
            {err}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {authMode === "signup" && (
            <div className="input-wrap">
              <label>Full Name</label>
              <input className="input" placeholder="Your full name" value={form.fullName} onChange={e => upd("fullName", e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="input-wrap">
            <label>Email</label>
            <input
              className="input"
              placeholder="you@example.com"
              value={form.email}
              onChange={e => upd("email", e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </div>
          <div className="input-wrap">
            <label>Password {authMode === "signup" && <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 12 }}>(min 6 characters)</span>}</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => upd("password", e.target.value)}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {authMode === "signup" && userType === "student" && (
            <div className="input-wrap">
              <label>College / University <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 12 }}>(optional)</span></label>
              <input className="input" placeholder="Your institution" value={form.college} onChange={e => upd("college", e.target.value)} />
            </div>
          )}
          {authMode === "signup" && userType === "business" && (
            <div className="input-wrap">
              <label>Business Name <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 12 }}>(optional)</span></label>
              <input className="input" placeholder="Your hostel / PG business" value={form.businessName} onChange={e => upd("businessName", e.target.value)} />
            </div>
          )}
          <button
            className="btn btn-pri btn-full btn-lg"
            type="submit"
            style={{ marginTop: 8, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed", transition: "opacity 0.2s" }}
            disabled={!canSubmit}
          >
            {loading ? "Please wait…" : authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="auth-toggle">
          {authMode === "login"
            ? <>{`Don't have an account? `}<a style={{ cursor: "pointer" }} onClick={() => switchMode("signup")}>Sign up</a></>
            : <>Already have an account? <a style={{ cursor: "pointer" }} onClick={() => switchMode("login")}>Sign in</a></>}
        </div>
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <a style={{ fontSize: 13, color: "var(--text3)", cursor: "pointer" }} onClick={() => setPage("landing")}>← Back to home</a>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENT: FILTER PANEL (collapsible overlay) ───────────
function FilterPanel({ show, onClose, pending, setPending, onApply, onReset }) {
  if (!show) return null;
  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "rgba(0,0,0,0.18)", backdropFilter: "blur(2px)"
      }} />

      {/* Panel */}
      <div className="scale-in" style={{
        position: "fixed", top: 72, left: 20, zIndex: 260,
        width: 300, background: "var(--card)",
        borderRadius: "var(--radius)", border: "1px solid var(--border)",
        boxShadow: "var(--shadow-lg)", padding: 24
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Filters</h3>
          <button className="btn btn-ghost btn-sm" style={{ padding: "4px 8px" }} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Max Price */}
        <div className="filter-group">
          <h4>Max Rent (₹/month)</h4>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 6 }}>
            {pending.maxPrice === 0 ? <em>No limit</em> : <span style={{ color: "var(--pri)", fontWeight: 600 }}>Up to ₹{pending.maxPrice.toLocaleString()}</span>}
          </div>
          <input type="range" min="0" max="15000" step="500" value={pending.maxPrice}
            onChange={e => setPending(p => ({ ...p, maxPrice: +e.target.value }))} />
          <div className="range-val"><span>₹0</span><span>₹15,000</span></div>
        </div>

        {/* Max Distance */}
        <div className="filter-group">
          <h4>Max Distance from You</h4>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 6 }}>
            {pending.maxDist === 0 ? <em>No limit</em> : <span style={{ color: "var(--pri)", fontWeight: 600 }}>Within {pending.maxDist} km</span>}
          </div>
          <input type="range" min="0" max="50" step="1" value={pending.maxDist}
            onChange={e => setPending(p => ({ ...p, maxDist: +e.target.value }))} />
          <div className="range-val"><span>0 km</span><span>50 km</span></div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onReset}>Reset</button>
          <button className="btn btn-pri btn-sm" style={{ flex: 2 }} onClick={onApply}>Apply Filters</button>
        </div>
      </div>
    </>
  );
}

// ─── COMPONENT: HOSTEL CARD ───────────────────────────────────
function HostelCard({ h, compareList, favorites, toggleCompare, toggleFav, onSelect }) {
  return (
    <div className="card card-elevated hostel-card fade-up" onClick={() => onSelect(h)}>
      <div style={{ overflow: "hidden", height: 200, position: "relative" }}>
        <img src={h.images[0]} alt={h.name} className="hostel-card-img" />

        <div style={{ position: "absolute", top: 10, left: 10 }}>
          <span className={`badge ${h.type === "Premium" ? "badge-pri" : h.type === "Standard" ? "badge-success" : "badge-warn"}`}>{h.type}</span>
        </div>
      </div>
      <div className="hostel-card-body">
        <div className="hostel-card-top">
          <div className="hostel-card-name">{h.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#f59e0b", fontWeight: 700, fontSize: 14, fontFamily: "var(--mono)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>{h.rating}
          </div>
        </div>
        <div className="hostel-card-addr">{h.address} {h.distLabel ? `• ${h.distLabel} away` : ""}</div>
        <div className="hostel-card-tags">
          {h.ac && <span className="badge badge-pri">AC</span>}
          {h.wifi && <span className="badge badge-pri">WiFi</span>}
          {h.food && <span className="badge badge-success">Meals</span>}
          {h.bathroom && <span className="badge badge-pri">Attached Bath</span>}
          <span className="badge badge-warn">{h.roomTypes.join(" / ")}</span>
        </div>
        <div className="hostel-card-price">
          <div><strong>₹{h.price.toLocaleString()}</strong><span>/month</span></div>
          <span className="badge badge-success">{h.availability} rooms left</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <button
            className={`btn btn-sm ${compareList.includes(h.id) ? "btn-pri" : "btn-out"}`}
            style={{ flex: 1, fontSize: 12 }}
            onClick={e => { e.stopPropagation(); toggleCompare(h.id); }}
          >
            {compareList.includes(h.id) ? <>{Icons.check} Added</> : <>{Icons.compare} Compare</>}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: "7px 10px" }}
            onClick={e => { e.stopPropagation(); toggleFav(h.id); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites.includes(h.id) ? "#ef4444" : "none"} stroke={favorites.includes(h.id) ? "#ef4444" : "currentColor"} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: EXPLORE ────────────────────────────────────────────
function ExplorePage({
  filteredHostels,
  pendingFilters, setPendingFilters,
  appliedFilters, setAppliedFilters,
  showFilterPanel, setShowFilterPanel,
  searchQuery, setSearchQuery,
  compareList, favorites, toggleCompare, toggleFav,
  userLoc, locStatus, requestLocation,
  isLoaded, onMapLoad, onMapUnmount,
  setPage, setSelectedHostel, setUser,
  setShowCompare,
}) {
  // Count how many filters are currently active
  const activeCount = appliedFilters
    ? [appliedFilters.maxPrice > 0, appliedFilters.maxDist > 0].filter(Boolean).length
    : 0;

  const handleApply = () => {
    setAppliedFilters({ ...pendingFilters });
    setShowFilterPanel(false);
  };

  const handleReset = () => {
    setPendingFilters({ maxPrice: 0, maxDist: 0 });
    setAppliedFilters(null);
    setShowFilterPanel(false);
  };

  return (
    <div className="fade-in">
      <nav className="nav">
        <NavLogo onClick={() => setPage("landing")} />
        <div className="nav-links">
          <button className="nav-link active">Explore</button>
          <button className="nav-link" onClick={() => setPage("mybookings")}>My Bookings</button>
          {compareList.length > 0 && (
            <button className="btn btn-out btn-sm" onClick={() => setShowCompare(true)}>{Icons.compare} Compare ({compareList.length})</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => { setUser(null); setPage("landing"); }}>{Icons.logout}</button>
        </div>
      </nav>

      {/* Filter Panel overlay */}
      <FilterPanel
        show={showFilterPanel}
        onClose={() => setShowFilterPanel(false)}
        pending={pendingFilters}
        setPending={setPendingFilters}
        onApply={handleApply}
        onReset={handleReset}
      />

      <div className="section">
        {/* Map */}
        <div style={{ marginBottom: 24, height: 300, borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)", position: "relative" }}>
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%" }}
              center={userLoc || { lat: 12.9716, lng: 77.5946 }}
              zoom={13}
              onLoad={onMapLoad}
              onUnmount={onMapUnmount}
            >
              {userLoc && (
                <Marker position={userLoc} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#007BFF", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 }} />
              )}
              {filteredHostels.filter(h => h.lat && h.lng && typeof h.lat === 'number' && typeof h.lng === 'number').map(h => (
                <Marker key={h.id} position={{ lat: h.lat, lng: h.lng }}
                  onClick={() => { setSelectedHostel(h); setPage("detail"); }}
                  icon={{ path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6, fillColor: "#0d9488", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 }}
                />
              ))}
            </GoogleMap>
          ) : (
            <div className="map-placeholder" style={{ height: "100%", marginBottom: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 1 }}>
                <div className="map-dot" />
                <span>{locStatus}</span>
                {locStatus.includes("⚠️") && <button className="btn btn-sm btn-pri" onClick={requestLocation}>Retry Detect Location</button>}
              </div>
            </div>
          )}
        </div>

        {/* Search + Filter button row */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
            <input className="input" placeholder="Search hostels by name or area..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ paddingLeft: 40 }} />
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }}>{Icons.search}</div>
          </div>

          {/* Filters toggle button with active badge */}
          <button
            className={`btn ${activeCount > 0 ? "btn-pri" : "btn-out"} btn-sm`}
            style={{ gap: 8, whiteSpace: "nowrap" }}
            onClick={() => setShowFilterPanel(prev => !prev)}
          >
            {Icons.filter}
            Filters
            {activeCount > 0 && (
              <span style={{
                background: "#fff", color: "var(--pri)", borderRadius: "50%",
                width: 18, height: 18, display: "inline-flex", alignItems: "center",
                justifyContent: "center", fontSize: 11, fontWeight: 700, lineHeight: 1
              }}>{activeCount}</span>
            )}
          </button>

          {/* Active filter pills */}
          {appliedFilters && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {appliedFilters.maxPrice > 0 && (
                <span className="badge badge-pri" style={{ fontSize: 12 }}>
                  ≤ ₹{appliedFilters.maxPrice.toLocaleString()}
                  <span style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => {
                    const next = { ...appliedFilters, maxPrice: 0 };
                    setPendingFilters(next);
                    setAppliedFilters(next.maxPrice === 0 && next.maxDist === 0 ? null : next);
                  }}>✕</span>
                </span>
              )}
              {appliedFilters.maxDist > 0 && (
                <span className="badge badge-pri" style={{ fontSize: 12 }}>
                  ≤ {appliedFilters.maxDist} km
                  <span style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => {
                    const next = { ...appliedFilters, maxDist: 0 };
                    setPendingFilters(next);
                    setAppliedFilters(next.maxPrice === 0 && next.maxDist === 0 ? null : next);
                  }}>✕</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Hostel grid — full width */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, color: "var(--text2)" }}>{filteredHostels.length} hostels found nearby</span>
            <select className="input" style={{ width: "auto" }} defaultValue="distance">
              <option value="distance">Sort: Nearest First</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
              <option value="rating">Highest Rated</option>
            </select>
          </div>
          <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
            {filteredHostels.map(h => (
              <HostelCard key={h.id} h={h} compareList={compareList} favorites={favorites}
                toggleCompare={toggleCompare} toggleFav={toggleFav}
                onSelect={(hostel) => { setSelectedHostel(hostel); setPage("detail"); }}
              />
            ))}
          </div>
          {filteredHostels.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text3)" }}>
              <p style={{ fontSize: 16, fontWeight: 600 }}>No hostels match your filters</p>
              <p style={{ fontSize: 14 }}>Try adjusting your filters or search query</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: DETAIL ─────────────────────────────────────────────
function DetailPage({ selectedHostel, setPage, setBookingHostel, setBookingConfirmed }) {
  const h = selectedHostel;
  const [imgIdx, setImgIdx] = useState(0);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    if (!h) return;
    const id = (h._id || h.id || "").toString();
    if (!id || id.length < 10) return; // skip if ID looks invalid
    API.getReviews(id).then(res => {
      setReviews(res.data || []);
    }).catch(() => setReviews([]));
  }, [h]);

  if (!h) return null;
  const hostelReviews = reviews;

  return (
    <div className="fade-in">
      <nav className="nav">
        <NavLogo onClick={() => setPage("landing")} />
        <div className="nav-links">
          <button className="btn btn-ghost btn-sm" onClick={() => setPage("explore")}>{Icons.chevLeft} Back to Explore</button>
        </div>
      </nav>
      <div className="section">
        <div className="detail-hero"><img src={h.images[imgIdx]} alt={h.name} /></div>
        <div className="detail-gallery">
          {h.images.map((img, i) => (
            <img key={i} src={img} alt="" className={i === imgIdx ? "active" : ""} onClick={() => setImgIdx(i)} />
          ))}
        </div>
        <div className="detail-info">
          <div>
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <span className={`badge ${h.type === "Premium" ? "badge-pri" : h.type === "Standard" ? "badge-success" : "badge-warn"}`} style={{ marginBottom: 8 }}>{h.type}</span>
                <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{h.name}</h1>
                <p style={{ color: "var(--text2)", fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>{Icons.mapPin} {h.address}{h.distLabel ? ` — ${h.distLabel} from you` : ""}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {h.mapsLink && (
                    <button
                      className="btn btn-out btn-sm"
                      onClick={() => window.open(h.mapsLink, "_blank")}
                    >
                      {Icons.mapPin} View on Google Maps
                    </button>
                  )}
                  {h.contactNumber && (
                    <button
                      className="btn btn-pri btn-sm"
                      onClick={() => window.open("https://wa.me/" + h.contactNumber.replace(/[^0-9]/g, ""), "_blank")}
                    >
                      📞 Contact Owner
                    </button>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  <Stars rating={h.rating} size={18} />
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16 }}>{h.rating}</span>
                </div>
                <span style={{ fontSize: 13, color: "var(--text3)" }}>{h.reviews} reviews</span>
              </div>
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 4 }}>Amenities</h3>
            <div className="amenity-grid">
              {[{ key: "ac", label: "Air Conditioning" }, { key: "wifi", label: "WiFi" }, { key: "food", label: "Meals Included" }, { key: "bathroom", label: "Attached Bathroom" }, { key: "gym", label: "Gym" }, { key: "laundry", label: "Laundry" }, { key: "parking", label: "Parking" }, { key: "cctv", label: "CCTV Security" }, { key: "powerBackup", label: "Power Backup" }, { key: "studyRoom", label: "Study Room" }].map(a => (
                <div key={a.key} className={`amenity-item ${h[a.key] ? "" : "no"}`}>{h[a.key] ? Icons.check : Icons.x} {a.label}</div>
              ))}
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 4 }}>Safety Rating</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "var(--pri-50)", borderRadius: "var(--radius-sm)", marginTop: 8 }}>
              {Icons.shield}
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--pri)" }}>{h.safety} / 5.0</div>
                <div style={{ fontSize: 13, color: "var(--text2)" }}>Verified safety score based on inspections & reviews</div>
              </div>
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12 }}>Reviews</h3>
            {hostelReviews.length > 0 ? hostelReviews.map(r => {
              const userName = r.user?.fullName || r.user?.name || r.user || "Student";
              const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : r.date || "";
              const reviewText = r.comment || r.text || "";
              return (
                <div key={r._id || r.id} className="card review-card">
                  <div className="review-header">
                    <div className="review-avatar">{userName[0]?.toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{userName}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>{dateStr}</div>
                    </div>
                    <div style={{ marginLeft: "auto" }}><Stars rating={r.rating} /></div>
                  </div>
                  <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6 }}>{reviewText}</p>
                </div>
              );
            }) : <p style={{ fontSize: 14, color: "var(--text3)" }}>No reviews yet for this hostel.</p>}

            <WriteReview hostelId={(h._id || h.id || "").toString()} onReviewAdded={(r) => setReviews(prev => [r, ...prev])} />
          </div>

          {/* ── RIGHT: Booking Card ── */}
          <div>
            <BookingCard h={h} setBookingHostel={setBookingHostel} setBookingConfirmed={setBookingConfirmed} />
            <div className="card" style={{ padding: 16, marginTop: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6 }}>{Icons.check} <strong>{h.availability} rooms</strong> currently available</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: MY BOOKINGS ────────────────────────────────────────
function MyBookingsPage({ hostels, bookings, setPage, setUser }) {
  return (
    <div className="fade-in">
      <nav className="nav">
        <NavLogo onClick={() => setPage("landing")} />
        <div className="nav-links">
          <button className="nav-link" onClick={() => setPage("explore")}>Explore</button>
          <button className="nav-link active">My Bookings</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setUser(null); setPage("landing"); }}>{Icons.logout}</button>
        </div>
      </nav>
      <div className="section">
        <h2 className="section-title">My Bookings</h2>
        <p className="section-sub">Share your Booking ID with the hostel owner to complete payment</p>
        {bookings.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text3)" }}>
            <p style={{ fontSize: 16, fontWeight: 600 }}>No bookings yet</p>
            <p style={{ fontSize: 14, marginTop: 4 }}>Explore hostels and confirm a booking slot!</p>
            <button className="btn btn-pri" style={{ marginTop: 16 }} onClick={() => setPage("explore")}>Explore Hostels</button>
          </div>
        )}
        <div className="grid-2">
          {(bookings || []).map(b => {
            const h = hostels.find(x => x.id === b.hostelId) || { name: b.hostelName || "—", images: ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"] };
            return (
              <div key={b.id} className="card card-elevated fade-up" style={{ overflow: "hidden" }}>
                <div style={{ display: "flex", gap: 16, padding: 20, paddingBottom: 14 }}>
                  <img src={h.images[0]} alt="" style={{ width: 90, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{h.name}</h4>
                    <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 6 }}>{b.roomType} Room • Move-in: {b.checkIn}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${b.status === "Completed" ? "badge-pri" : "badge-success"}`}>{b.status}</span>
                      <span className={`badge ${b.paymentStatus === "Paid" ? "badge-success" : "badge-warn"}`}>
                        {b.paymentStatus === "Paid" ? "✅ Paid" : "⏳ Payment Pending"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Booking ID — prominent for sharing with owner */}
                <div style={{ margin: "0 20px 14px", padding: "12px 16px", background: "var(--pri-50)", borderRadius: "var(--radius-sm)", border: "1px solid var(--pri-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your Booking ID</p>
                    <p style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18, color: "var(--pri)" }}>{b.bookingId}</p>
                  </div>
                  <button
                    className="btn btn-out btn-sm"
                    onClick={() => navigator.clipboard.writeText(b.bookingId).then(() => alert("Booking ID copied!"))}
                  >
                    Copy ID
                  </button>
                </div>

                {b.paymentStatus !== "Paid" && (
                  <div style={{ margin: "0 20px 14px", padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius-sm)" }}>
                    <p style={{ fontSize: 12, color: "#92400e", lineHeight: 1.5 }}>
                      💡 Share your Booking ID <strong>{b.bookingId}</strong> with the hostel owner to pay ₹{b.totalAmount?.toLocaleString()}. They will mark it as paid after receiving.
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
                  <span style={{ fontSize: 13, color: "var(--text2)", alignSelf: "center" }}>Total Amount</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--pri)", fontSize: 15 }}>₹{b.totalAmount?.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: COMPARE ───────────────────────────────────────────
function CompareModal({ compareList, hostels, onClose }) {
  const compareHostels = compareList.map(id => hostels.find(h => h.id === id)).filter(Boolean);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 800 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Compare Hostels</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body">
          <div className="compare-table">
            <table>
              <thead>
                <tr><th>Feature</th>{compareHostels.map(h => <th key={h.id}>{h.name}</th>)}</tr>
              </thead>
              <tbody>
                {[
                  { label: "Price", fn: h => `₹${h.price.toLocaleString()}/mo` },
                  { label: "Distance", fn: h => h.distLabel || "—" },
                  { label: "Rating", fn: h => `⭐ ${h.rating}` },
                  { label: "Type", fn: h => h.type },
                  { label: "Rooms", fn: h => h.roomTypes.join(", ") },
                  { label: "AC", fn: h => h.ac ? "✅" : "❌" },
                  { label: "WiFi", fn: h => h.wifi ? "✅" : "❌" },
                  { label: "Meals", fn: h => h.food ? "✅" : "❌" },
                  { label: "Attached Bath", fn: h => h.bathroom ? "✅" : "❌" },
                  { label: "Safety", fn: h => `${h.safety}/5` },
                  { label: "Gym", fn: h => h.gym ? "✅" : "❌" },
                  { label: "Study Room", fn: h => h.studyRoom ? "✅" : "❌" },
                  { label: "Available", fn: h => `${h.availability} rooms` },
                ].map(row => (
                  <tr key={row.label}>
                    <td style={{ fontWeight: 600 }}>{row.label}</td>
                    {compareHostels.map(h => <td key={h.id}>{row.fn(h)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENT: BOOKING CARD ─────────────────────────────────
function BookingCard({ h, setBookingHostel, setBookingConfirmed }) {
  const [roomType, setRoomType] = useState(h.roomTypes[0]);
  const [moveIn, setMoveIn] = useState("2026-04-01");

  const platformFee = 199;
  const gst = Math.round(h.price * 0.03);
  const totalBeforeDeposit = h.price + platformFee + gst;
  const totalWithDeposit = totalBeforeDeposit + h.deposit;

  return (
    <div className="card checkout-card card-elevated">
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Book This Hostel</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>No payment collected here — confirm your slot and contact the owner to pay directly.</p>

      <div className="input-wrap" style={{ marginBottom: 12 }}>
        <label>Room Type</label>
        <select value={roomType} onChange={e => setRoomType(e.target.value)}>
          {h.roomTypes.map(t => <option key={t} value={t}>{t} Room</option>)}
        </select>
      </div>
      <div className="input-wrap" style={{ marginBottom: 16 }}>
        <label>Move-in Date</label>
        <input className="input" type="date" value={moveIn} onChange={e => setMoveIn(e.target.value)} />
      </div>

      {/* ── Amount Breakdown ── */}
      <div style={{ background: "var(--pri-50)", borderRadius: "var(--radius-sm)", padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Cost Breakdown</p>
        <div className="checkout-row"><span>Monthly Rent</span><span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>₹{h.price.toLocaleString()}</span></div>
        <div className="checkout-row"><span style={{ color: "var(--text3)" }}>GST (3%)</span><span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>₹{gst.toLocaleString()}</span></div>
        <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Platform Fee</span><span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>₹{platformFee}</span></div>
        <div style={{ borderTop: "1px dashed var(--border)", margin: "8px 0" }} />
        <div className="checkout-row"><span style={{ fontWeight: 600 }}>Subtotal (1st month)</span><span style={{ fontFamily: "var(--mono)", fontWeight: 700 }}>₹{totalBeforeDeposit.toLocaleString()}</span></div>
        <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Security Deposit (refundable)</span><span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>₹{h.deposit.toLocaleString()}</span></div>
        <div style={{ borderTop: "2px solid var(--border)", marginTop: 8, paddingTop: 10 }}>
          <div className="checkout-row total"><span>Total to Pay Owner</span><span>₹{totalWithDeposit.toLocaleString()}</span></div>
        </div>
        <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 8, lineHeight: 1.5 }}>* GST is applicable on rent as per government norms. Deposit is fully refundable at checkout.</p>
      </div>

      {/* ── Confirm Booking ── */}
      <button
        className="btn btn-pri btn-full btn-lg"
        onClick={() => { setBookingHostel({ ...h, roomType, moveIn, totalWithDeposit }); setBookingConfirmed(true); }}
      >
        ✅ Confirm Booking Slot
      </button>

      {/* ── Contact to Pay ── */}
      {h.contactNumber && (
        <button
          className="btn btn-out btn-full"
          style={{ marginTop: 10 }}
          onClick={() => window.open("https://wa.me/" + h.contactNumber.replace(/[^0-9]/g, ""), "_blank")}
        >
          💬 Contact Owner to Pay
        </button>
      )}
      <p style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
        Booking only reserves your slot. Payment is made directly to the owner. Free cancellation within 24 hours.
      </p>
    </div>
  );
}

// ─── COMPONENT: WRITE A REVIEW ────────────────────────────────
function WriteReview({ hostelId, onReviewAdded }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  if (submitted) {
    return (
      <div style={{ marginTop: 24, padding: 16, background: "#ecfdf5", borderRadius: "var(--radius-sm)", border: "1px solid #6ee7b7", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#065f46" }}>Thanks for your review! It helps other students.</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Write a Review</h3>
      <div className="card" style={{ padding: 20 }}>
        {/* Star rating picker */}
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>Your Rating</p>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <svg
                key={i}
                width="28" height="28" viewBox="0 0 24 24"
                fill={(hovered || rating) >= i ? "#f59e0b" : "#e5e7eb"}
                stroke="none"
                style={{ cursor: "pointer", transition: "fill 0.15s" }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(i)}
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            ))}
            {rating > 0 && <span style={{ fontSize: 13, color: "var(--text3)", alignSelf: "center", marginLeft: 4 }}>{["", "Poor", "Fair", "Good", "Very Good", "Excellent"][rating]}</span>}
          </div>
        </div>
        <div className="input-wrap" style={{ marginBottom: 14 }}>
          <label>Your Experience</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Share your experience about this hostel — food, cleanliness, safety, staff..."
            value={text}
            onChange={e => setText(e.target.value)}
            style={{ resize: "vertical", minHeight: 80 }}
          />
        </div>
        <button
          className="btn btn-pri btn-full"
          disabled={rating === 0 || text.trim().length < 10 || loading}
          onClick={async () => {
            if (!localStorage.getItem("sarp_token")) {
              setErr("Please log in to submit a review."); return;
            }
            setLoading(true); setErr("");
            try {
              const res = await API.createReview({ hostelId: (hostelId || "").toString(), rating: Number(rating), comment: text.trim() });
              onReviewAdded && onReviewAdded(res.data);
              setSubmitted(true);
            } catch (e) {
              setErr(e.message || "Failed to submit review");
            } finally { setLoading(false); }
          }}
        >
          Submit Review
        </button>
        {err && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{err}</div>}
        {rating === 0 && <p style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 8 }}>Select a star rating to continue</p>}
      </div>

    </div>
  );
}

// ─── MODAL: BOOKING CONFIRMED ─────────────────────────────────
function BookingConfirmedModal({ bookingHostel, onClose, setPage }) {
  const bookingId = "#SS" + Date.now().toString().slice(-6);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-body" style={{ textAlign: "center", padding: "36px 32px" }}>
          <div className="confirm-anim">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Slot Reserved!</h2>
          <p style={{ color: "var(--text2)", fontSize: 14, marginBottom: 20 }}>Your booking slot at <strong>{bookingHostel?.name}</strong> is confirmed. Contact the owner to complete payment.</p>

          {/* Booking Summary */}
          <div style={{ background: "var(--pri-50)", borderRadius: "var(--radius-sm)", padding: 16, marginBottom: 16, textAlign: "left" }}>
            <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Booking ID</span><span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--pri)" }}>{bookingId}</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Hostel</span><span style={{ fontWeight: 600 }}>{bookingHostel?.name}</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Room Type</span><span>{bookingHostel?.roomType || "Single"}</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)" }}>Move-in</span><span>{bookingHostel?.moveIn || "2026-04-01"}</span></div>
            <div style={{ borderTop: "1px dashed var(--border)", margin: "8px 0" }} />
            <div className="checkout-row"><span style={{ color: "var(--text3)", fontSize: 12 }}>Monthly Rent</span><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>₹{bookingHostel?.price?.toLocaleString()}</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)", fontSize: 12 }}>GST (3%)</span><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>₹{bookingHostel ? Math.round(bookingHostel.price * 0.03).toLocaleString() : 0}</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)", fontSize: 12 }}>Platform Fee</span><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>₹199</span></div>
            <div className="checkout-row"><span style={{ color: "var(--text3)", fontSize: 12 }}>Security Deposit</span><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>₹{bookingHostel?.deposit?.toLocaleString()}</span></div>
            <div style={{ borderTop: "2px solid var(--border)", marginTop: 8, paddingTop: 10 }}>
              <div className="checkout-row total"><span>Total to Pay Owner</span><span>₹{bookingHostel?.totalWithDeposit?.toLocaleString() || "—"}</span></div>
            </div>
          </div>

          {/* Notice */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius-sm)", padding: 12, marginBottom: 16, textAlign: "left" }}>
            <p style={{ fontSize: 13, color: "#92400e", fontWeight: 600, marginBottom: 4 }}>💡 Payment Instructions</p>
            <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.6 }}>Please contact the hostel owner directly to pay ₹{bookingHostel?.totalWithDeposit?.toLocaleString()}. Do not pay to any third party. SARP only helps students find and book — we do not collect rent or deposits.</p>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {bookingHostel?.contactNumber && (
              <button
                className="btn btn-out"
                style={{ flex: 1 }}
                onClick={() => window.open("https://wa.me/" + bookingHostel.contactNumber.replace(/[^0-9]/g, ""), "_blank")}
              >
                💬 WhatsApp Owner
              </button>
            )}
            <button className="btn btn-pri" style={{ flex: 1 }} onClick={() => { onClose(); setPage("mybookings"); }}>
              View My Bookings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: ADD HOSTEL ────────────────────────────────────────
function AddHostelModal({ hostels, setHostels, onClose }) {
  const [hostelLocStatus, setHostelLocStatus] = useState("idle");
  const [newHostelData, setNewHostelData] = useState({
    name: "", address: "", city: "", price: "", deposit: "", totalRooms: "",
    roomTypes: "Single & Shared", type: "Standard",
    ac: false, wifi: false, food: false, bathroom: false,
    gym: false, laundry: false, parking: false, cctv: false,
    powerBackup: false, studyRoom: false,
    lat: null, lng: null,
    mapsLink: "",
    contactNumber: "",
    previewImages: [],
  });

  // Only runs when owner explicitly clicks the GPS button — never auto-runs
  const detectHostelLocation = useCallback(async () => {
    setHostelLocStatus("detecting");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const geo = await reverseGeocode(lat, lng);
          // Always overwrite with GPS result when owner clicks the button
          setNewHostelData(prev => ({
            ...prev, lat, lng,
            address: geo.address || prev.address,
            city: geo.city || prev.city,
          }));
          setHostelLocStatus("success");
        },
        () => {
          setHostelLocStatus("error");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setHostelLocStatus("error");
    }
  }, []);



  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  const handleSubmit = async () => {
    setSubmitErr(""); setSubmitLoading(true);
    try {
      const roomTypes = newHostelData.roomTypes.includes("&")
        ? ["Single", "Shared"]
        : newHostelData.roomTypes === "All Types"
          ? ["Single", "Shared", "Triple"]
          : [newHostelData.roomTypes.replace(" Only", "")];

      const payload = {
        name: newHostelData.name,
        address: newHostelData.address,
        city: newHostelData.city || "Bangalore",
        latitude: newHostelData.lat || undefined,
        longitude: newHostelData.lng || undefined,
        price: parseInt(newHostelData.price) || 0,
        deposit: parseInt(newHostelData.deposit) || 0,
        hostelType: newHostelData.type,
        roomTypes,
        ac: newHostelData.ac, wifi: newHostelData.wifi, food: newHostelData.food,
        attachedBathroom: newHostelData.bathroom,
        bathroom: newHostelData.bathroom,
        gym: newHostelData.gym, laundry: newHostelData.laundry,
        parking: newHostelData.parking, cctv: newHostelData.cctv,
        powerBackup: newHostelData.powerBackup, studyRoom: newHostelData.studyRoom,
        availableRooms: parseInt(newHostelData.totalRooms) || 10,
        totalRooms: parseInt(newHostelData.totalRooms) || 10,
        mapsLink: newHostelData.mapsLink || "",
        contactNumber: newHostelData.contactNumber || "",
        images: newHostelData.previewImages?.length
          ? newHostelData.previewImages
          : ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"],
      };
      const res = await API.createHostel(payload);
      setHostels(prev => [mapHostel(res.data), ...prev]);
      onClose();
    } catch (e) {
      setSubmitErr(e.message || "Failed to create hostel");
    } finally { setSubmitLoading(false); }
  };


  const upd = (key, val) => setNewHostelData(prev => ({ ...prev, [key]: val }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 800 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add New Hostel Listing</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="input-wrap" style={{ gridColumn: "span 2" }}>
                <label>Hostel Name</label>
                <input className="input" placeholder="e.g., Sunrise Student Living" value={newHostelData.name} onChange={e => upd("name", e.target.value)} />
              </div>
              <div className="input-wrap" style={{ gridColumn: "span 2" }}>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Hostel Address</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ padding: "3px 10px", fontSize: 11, background: "var(--pri-50)", color: "var(--pri)", border: "1px solid var(--pri-light)", borderRadius: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
                    onClick={detectHostelLocation}
                    title="Auto-fill address from your current GPS location"
                  >
                    {hostelLocStatus === "detecting"
                      ? <><div className="loc-spinner" style={{ width: 10, height: 10, border: "1.5px solid var(--pri)", borderTopColor: "transparent" }} /> Detecting...</>
                      : <>{Icons.crosshair} Use My GPS</>
                    }
                  </button>
                </label>
                <input
                  className="input"
                  placeholder="Type hostel address manually e.g. 12 MG Road, Koramangala"
                  value={newHostelData.address}
                  onChange={e => upd("address", e.target.value)}
                />
                {hostelLocStatus === "success" && (
                  <span style={{ fontSize: 11, color: "var(--success)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                    ✓ GPS address filled — you can edit it if needed
                  </span>
                )}
                {hostelLocStatus === "error" && (
                  <span style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>
                    ⚠ GPS unavailable — please type the address manually
                  </span>
                )}
              </div>
              <div className="input-wrap" style={{ gridColumn: "span 2" }}>
                <label>Google Maps Link</label>
                <input className="input" placeholder="Paste Google Maps link (e.g. https://maps.google.com/?q=...)" value={newHostelData.mapsLink} onChange={e => upd("mapsLink", e.target.value)} />
                <span style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Students will see a "View on Google Maps" button using this link</span>
              </div>
              <div className="input-wrap">
                <label>City</label>
                <input className="input" placeholder="e.g. Bangalore" value={newHostelData.city} onChange={e => upd("city", e.target.value)} />
              </div>
              <div className="input-wrap">
                <label>Monthly Rent (₹)</label>
                <input className="input" type="number" placeholder="e.g., 7000" value={newHostelData.price} onChange={e => upd("price", e.target.value)} />
              </div>
              <div className="input-wrap">
                <label>Security Deposit (₹)</label>
                <input className="input" type="number" placeholder="e.g., 3500" value={newHostelData.deposit} onChange={e => upd("deposit", e.target.value)} />
              </div>
              <div className="input-wrap">
                <label>Total Rooms</label>
                <input className="input" type="number" placeholder="e.g., 50" value={newHostelData.totalRooms} onChange={e => upd("totalRooms", e.target.value)} />
              </div>
              <div className="input-wrap">
                <label>Room Types</label>
                <select value={newHostelData.roomTypes} onChange={e => upd("roomTypes", e.target.value)}>
                  <option>Single & Shared</option><option>Single Only</option><option>Shared Only</option><option>All Types</option>
                </select>
              </div>
              <div className="input-wrap">
                <label>Hostel Type</label>
                <select value={newHostelData.type} onChange={e => upd("type", e.target.value)}>
                  <option>Premium</option><option>Standard</option><option>Budget</option>
                </select>
              </div>
            </div>
            <h4 style={{ fontSize: 14, fontWeight: 700, marginTop: 20, marginBottom: 10, color: "var(--text2)" }}>Amenities</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {[{ key: "ac", label: "AC" }, { key: "wifi", label: "WiFi" }, { key: "food", label: "Meals" }, { key: "bathroom", label: "Attached Bath" }, { key: "gym", label: "Gym" }, { key: "laundry", label: "Laundry" }, { key: "parking", label: "Parking" }, { key: "cctv", label: "CCTV" }, { key: "powerBackup", label: "Power Backup" }, { key: "studyRoom", label: "Study Room" }].map(a => (
                <label key={a.key} className="filter-check" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={newHostelData[a.key]} onChange={e => upd(a.key, e.target.checked)} /> {a.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Contact Number ── */}
            <div className="input-wrap">
              <label>Owner Contact Number</label>
              <input
                className="input"
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={newHostelData.contactNumber}
                onChange={e => upd("contactNumber", e.target.value)}
              />
              <span style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Students will see a call/WhatsApp button to reach you directly</span>
            </div>

            {/* ── Photo Upload ── */}
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text2)" }}>Hostel Photos</h4>
              <div
                style={{ border: "2px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "20px 16px", textAlign: "center", cursor: "pointer", background: "var(--card)" }}
                onClick={() => document.getElementById("hostel-photo-upload").click()}
              >
                <div style={{ color: "var(--text3)", marginBottom: 6 }}>{Icons.image}</div>
                <p style={{ fontSize: 13, color: "var(--pri)", fontWeight: 600 }}>Click to upload photos</p>
                <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>JPG, PNG — up to 5 photos</p>
                <input
                  id="hostel-photo-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={e => {
                    const files = Array.from(e.target.files).slice(0, 5);
                    Promise.all(files.map(f => compressImage(f)))
                      .then(base64Urls => upd("previewImages", base64Urls));
                  }}
                />
              </div>
              {newHostelData.previewImages && newHostelData.previewImages.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {newHostelData.previewImages.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={url} alt="" style={{ width: 72, height: 56, borderRadius: 8, objectFit: "cover", border: "2px solid var(--pri)" }} />
                      <button
                        style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "var(--danger)", border: "none", color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => upd("previewImages", newHostelData.previewImages.filter((_, idx) => idx !== i))}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", background: "#fafbfc", borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)" }}>
          {submitErr && <p style={{ color: "var(--danger)", fontSize: 13, alignSelf: "center", flex: 1 }}>⚠ {submitErr}</p>}
          <button className="btn btn-out" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" disabled={!newHostelData.name || !newHostelData.address || !newHostelData.price || submitLoading} onClick={handleSubmit}>
            {submitLoading ? "Publishing..." : "Confirm & Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENT: BOOKING MANAGEMENT TAB ──────────────────────
function BookingManagementTab({ bookings, setBookings, hostels, setHostels }) {
  const [searchId, setSearchId] = useState("");
  const [foundBooking, setFoundBooking] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleSearch = () => {
    setSearchError("");
    setFoundBooking(null);
    setPaymentSuccess(false);
    const query = searchId.trim().toUpperCase().replace(/^#/, "");
    if (!query) { setSearchError("Please enter a Booking ID."); return; }
    const match = bookings.find(b =>
      (b.bookingId || "").toUpperCase().replace(/^#/, "") === query ||
      (b.bookingRef || "").toUpperCase().replace(/^#/, "") === query ||
      String(b.id) === query
    );
    if (match) {
      const hostel = hostels.find(h => String(h._id || h.id) === String(match.hostelId) || String(h.id) === String(match.hostelId));
      setFoundBooking({ ...match, hostelName: hostel?.name || match.hostelName || "Unknown Hostel" });
      setPaymentAmount(match.totalAmount?.toString() || "");
    } else {
      setSearchError("No booking found with ID \"" + query + "\". Ask the student to share their Booking ID.");
    }
  };

  const handleCollectPayment = () => {
    if (!foundBooking) return;
    // Mark booking as paid
    setBookings(prev => prev.map(b =>
      b.id === foundBooking.id
        ? { ...b, paymentStatus: "Paid", status: "Completed" }
        : b
    ));
    setFoundBooking(prev => ({ ...prev, paymentStatus: "Paid", status: "Completed" }));
    setPaymentSuccess(true);
  };

  const allOwnerBookings = bookings;

  return (
    <div className="fade-up">
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Booking Management</h2>
      <p className="section-sub">Search by Booking ID to collect payment from the student</p>

      {/* ── Payment Collection Card ── */}
      <div className="card card-elevated" style={{ padding: 24, marginBottom: 28 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
          {Icons.dollar} Collect Payment from Student
        </h3>
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>
          Ask the student for their Booking ID (shown in their "My Bookings" page) and enter it below.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            className="input"
            placeholder="Enter Booking ID (e.g. #SS123456)"
            value={searchId}
            onChange={e => setSearchId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-pri" onClick={handleSearch}>
            {Icons.search} Search
          </button>
        </div>

        {searchError && (
          <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm)", color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
            ⚠️ {searchError}
          </div>
        )}

        {foundBooking && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {/* Booking Details Header */}
            <div style={{ background: foundBooking.paymentStatus === "Paid" ? "#ecfdf5" : "var(--pri-50)", padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>BOOKING ID</span>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: "var(--pri)" }}>{foundBooking.bookingId}</div>
              </div>
              <span className={`badge ${foundBooking.paymentStatus === "Paid" ? "badge-success" : "badge-warn"}`}>
                {foundBooking.paymentStatus === "Paid" ? "✅ Paid" : "⏳ Payment Pending"}
              </span>
            </div>

            {/* Booking Info */}
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>STUDENT</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{foundBooking.studentName || "Student"}</p>
                {foundBooking.studentEmail && (
                  <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>✉️ {foundBooking.studentEmail}</p>
                )}
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>HOSTEL</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{foundBooking.hostelName}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>ROOM TYPE</p>
                <p style={{ fontSize: 14 }}>{foundBooking.roomType}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>MOVE-IN DATE</p>
                <p style={{ fontSize: 14 }}>{foundBooking.checkIn}</p>
              </div>
            </div>

            {/* Amount Breakdown */}
            <div style={{ background: "#f8fafc", padding: "14px 20px", borderTop: "1px solid var(--border)" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Amount to Collect</p>
              <div className="checkout-row" style={{ padding: "6px 0" }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>Monthly Rent</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹{foundBooking.amount?.toLocaleString()}</span>
              </div>
              <div className="checkout-row" style={{ padding: "6px 0" }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>GST (3%)</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹{Math.round((foundBooking.amount || 0) * 0.03).toLocaleString()}</span>
              </div>
              <div className="checkout-row" style={{ padding: "6px 0" }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>Platform Fee</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹199</span>
              </div>
              <div className="checkout-row" style={{ padding: "6px 0" }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>Security Deposit (refundable)</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹{foundBooking.deposit?.toLocaleString()}</span>
              </div>
              <div style={{ borderTop: "2px solid var(--border)", marginTop: 8, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Total to Collect</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18, color: "var(--pri)" }}>₹{foundBooking.totalAmount?.toLocaleString()}</span>
              </div>
            </div>

            {/* Action */}
            {foundBooking.paymentStatus !== "Paid" ? (
              <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
                <button className="btn btn-pri btn-full btn-lg" onClick={handleCollectPayment}>
                  ✅ Mark as Payment Received
                </button>
                <p style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 8 }}>
                  Confirm only after you have physically received the payment from the student.
                </p>
              </div>
            ) : (
              <div style={{ padding: "16px 20px", borderTop: "1px solid #6ee7b7", background: "#ecfdf5", textAlign: "center" }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#065f46" }}>
                  ✅ Payment of ₹{foundBooking.totalAmount?.toLocaleString()} received successfully!
                </p>
                {paymentSuccess && <p style={{ fontSize: 12, color: "#059669", marginTop: 4 }}>Booking status updated to Completed.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── All Bookings Table ── */}
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>All Bookings ({allOwnerBookings.length})</h3>
      <div className="card" style={{ overflow: "hidden" }}>
        {allOwnerBookings.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
            <p style={{ fontSize: 15, fontWeight: 600 }}>No bookings yet</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>When students book your hostels, they will appear here.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Booking ID", "Student", "Email", "Hostel", "Room", "Check-in", "Total", "Payment"].map(col => (
                  <th key={col} style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allOwnerBookings.map((b, i) => {
                const hostel = hostels.find(h => String(h._id || h.id) === String(b.hostelId) || String(h.id) === String(b.hostelId));
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--pri)", fontWeight: 700 }}>{b.bookingId}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{b.studentName || "Student"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text2)" }}>{b.studentEmail || "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14 }}>{hostel?.name || b.hostelName || "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14 }}>{b.roomType}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, color: "var(--text2)" }}>{b.checkIn}</td>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>₹{b.totalAmount?.toLocaleString() || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className={`badge ${b.paymentStatus === "Paid" ? "badge-success" : "badge-warn"}`}>
                        {b.paymentStatus === "Paid" ? "Paid" : "Pending"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── MODAL: VIEW AMENITIES ───────────────────────────────────
function ViewAmenitiesModal({ hostel, onClose }) {
  const h = hostel;
  const amenities = [
    { key: "ac", label: "Air Conditioning", icon: "❄️" },
    { key: "wifi", label: "WiFi", icon: "📶" },
    { key: "food", label: "Meals Included", icon: "🍽️" },
    { key: "bathroom", label: "Attached Bathroom", icon: "🚿" },
    { key: "gym", label: "Gym", icon: "🏋️" },
    { key: "laundry", label: "Laundry", icon: "👕" },
    { key: "parking", label: "Parking", icon: "🅿️" },
    { key: "cctv", label: "CCTV Security", icon: "📷" },
    { key: "powerBackup", label: "Power Backup", icon: "⚡" },
    { key: "studyRoom", label: "Study Room", icon: "📚" },
  ];

  const available = amenities.filter(a => h[a.key]);
  const unavailable = amenities.filter(a => !h[a.key]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{h.name}</h3>
            <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 2 }}>{h.address}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body">

          {/* Key Info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Price", val: "₹" + h.price.toLocaleString() + "/mo" },
              { label: "Type", val: h.type },
              { label: "Rooms", val: h.roomTypes.join(" / ") },
              { label: "Rating", val: "⭐ " + h.rating + "/5" },
              { label: "Safety", val: "🛡️ " + h.safety + "/5" },
              { label: "Available", val: h.availability + " rooms" },
            ].map((item, i) => (
              <div key={i} style={{ background: "var(--pri-50)", padding: "10px 12px", borderRadius: "var(--radius-sm)", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{item.label}</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>{item.val}</p>
              </div>
            ))}
          </div>

          {/* Available Amenities */}
          <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--success)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            ✅ Available ({available.length})
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
            {available.map(a => (
              <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#ecfdf5", borderRadius: "var(--radius-sm)", border: "1px solid #6ee7b7" }}>
                <span style={{ fontSize: 18 }}>{a.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: "#065f46" }}>{a.label}</span>
              </div>
            ))}
          </div>

          {/* Unavailable Amenities */}
          {unavailable.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                ❌ Not Available ({unavailable.length})
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {unavailable.map(a => (
                  <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f9fafb", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 18, opacity: 0.4 }}>{a.icon}</span>
                    <span style={{ fontSize: 14, color: "var(--text3)", textDecoration: "line-through" }}>{a.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: EDIT AMENITIES ────────────────────────────────────
function EditAmenitiesModal({ hostel, setHostels, onClose }) {
  const [form, setForm] = useState({
    name: hostel.name,
    address: hostel.address,
    price: hostel.price,
    deposit: hostel.deposit,
    type: hostel.type,
    roomTypes: hostel.roomTypes,
    availability: hostel.availability,
    totalRooms: hostel.totalRooms,
    contactNumber: hostel.contactNumber || "",
    mapsLink: hostel.mapsLink || "",
    images: hostel.images?.length ? hostel.images : [],
    ac: hostel.ac,
    wifi: hostel.wifi,
    food: hostel.food,
    bathroom: hostel.bathroom,
    gym: hostel.gym,
    laundry: hostel.laundry,
    parking: hostel.parking,
    cctv: hostel.cctv,
    powerBackup: hostel.powerBackup,
    studyRoom: hostel.studyRoom,
  });
  const [saved, setSaved] = useState(false);

  const upd = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name, address: form.address,
        price: form.price, deposit: form.deposit,
        hostelType: form.type, type: form.type,
        roomTypes: form.roomTypes,
        availableRooms: form.availability, availability: form.availability,
        totalRooms: form.totalRooms,
        mapsLink: form.mapsLink, contactNumber: form.contactNumber,
        images: form.images?.length
          ? form.images
          : ["https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600"],
        ac: form.ac, wifi: form.wifi, food: form.food,
        attachedBathroom: form.bathroom, bathroom: form.bathroom,
        gym: form.gym, laundry: form.laundry, parking: form.parking,
        cctv: form.cctv, powerBackup: form.powerBackup, studyRoom: form.studyRoom,
      };
      const res = await API.updateHostel(hostel._id || hostel.id, payload);
      const updated = mapHostel(res.data);
      setHostels(prev => prev.map(h => (h._id || h.id) === (hostel._id || hostel.id) ? updated : h));
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1200);
    } catch (e) {
      setSaved(false);
      alert("Failed to save: " + e.message);
    }
  };

  const amenityList = [
    { key: "ac", label: "Air Conditioning", icon: "❄️" },
    { key: "wifi", label: "WiFi", icon: "📶" },
    { key: "food", label: "Meals Included", icon: "🍽️" },
    { key: "bathroom", label: "Attached Bathroom", icon: "🚿" },
    { key: "gym", label: "Gym", icon: "🏋️" },
    { key: "laundry", label: "Laundry", icon: "👕" },
    { key: "parking", label: "Parking", icon: "🅿️" },
    { key: "cctv", label: "CCTV Security", icon: "📷" },
    { key: "powerBackup", label: "Power Backup", icon: "⚡" },
    { key: "studyRoom", label: "Study Room", icon: "📚" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Edit Listing</h3>
            <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 2 }}>{hostel.name}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {saved && (
            <div style={{ padding: "12px 16px", background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#065f46" }}>Changes saved successfully!</span>
            </div>
          )}

          {/* Basic Info */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Basic Info</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="input-wrap" style={{ gridColumn: "span 2" }}>
                <label>Hostel Name</label>
                <input className="input" value={form.name} onChange={e => upd("name", e.target.value)} />
              </div>
              <div className="input-wrap" style={{ gridColumn: "span 2" }}>
                <label>Address</label>
                <input className="input" value={form.address} onChange={e => upd("address", e.target.value)} />
              </div>
              <div className="input-wrap">
                <label>Monthly Rent (₹)</label>
                <input className="input" type="number" value={form.price} onChange={e => upd("price", parseInt(e.target.value) || 0)} />
              </div>
              <div className="input-wrap">
                <label>Security Deposit (₹)</label>
                <input className="input" type="number" value={form.deposit} onChange={e => upd("deposit", parseInt(e.target.value) || 0)} />
              </div>
              <div className="input-wrap">
                <label>Hostel Type</label>
                <select value={form.type} onChange={e => upd("type", e.target.value)}>
                  <option>Premium</option><option>Standard</option><option>Budget</option>
                </select>
              </div>
              <div className="input-wrap">
                <label>Available Rooms</label>
                <input className="input" type="number" value={form.availability} onChange={e => upd("availability", parseInt(e.target.value) || 0)} />
              </div>
              <div className="input-wrap">
                <label>Contact Number</label>
                <input className="input" type="tel" value={form.contactNumber} onChange={e => upd("contactNumber", e.target.value)} placeholder="+91 98765 43210" />
              </div>
              <div className="input-wrap">
                <label>Google Maps Link</label>
                <input className="input" value={form.mapsLink} onChange={e => upd("mapsLink", e.target.value)} placeholder="https://maps.google.com/..." />
              </div>
            </div>
          </div>

          {/* Photos */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Hostel Photos</h4>

            {/* Existing photos */}
            {form.images && form.images.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {form.images.map((url, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt=""
                      style={{ width: 80, height: 62, borderRadius: 8, objectFit: "cover", border: "2px solid var(--pri)", display: "block" }}
                    />
                    <button
                      type="button"
                      style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--danger)", border: "none", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                      onClick={() => upd("images", form.images.filter((_, idx) => idx !== i))}
                      title="Remove photo"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload new photos */}
            <div
              style={{ border: "2px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px", textAlign: "center", cursor: "pointer", background: "var(--card)" }}
              onClick={() => document.getElementById("edit-photo-upload").click()}
            >
              <p style={{ fontSize: 13, color: "var(--pri)", fontWeight: 600, margin: 0 }}>＋ Add / Replace Photos</p>
              <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>JPG, PNG — up to 5 photos total</p>
              <input
                id="edit-photo-upload"
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={e => {
                  const files = Array.from(e.target.files).slice(0, 5);
                  Promise.all(files.map(f => compressImage(f)))
                    .then(newUrls => upd("images", [...form.images, ...newUrls].slice(0, 5)));
                  e.target.value = "";
                }}
              />
            </div>
            {form.images.length === 0 && (
              <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 6, textAlign: "center" }}>No photos yet — click above to upload</p>
            )}
          </div>

          {/* Amenities */}
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Amenities</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {amenityList.map(a => (
                <label
                  key={a.key}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "12px 14px",
                    background: form[a.key] ? "#ecfdf5" : "#f9fafb",
                    border: form[a.key] ? "1.5px solid #6ee7b7" : "1.5px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form[a.key]}
                    onChange={e => upd(a.key, e.target.checked)}
                    style={{ accentColor: "var(--pri)", width: 16, height: 16 }}
                  />
                  <span style={{ fontSize: 18 }}>{a.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: form[a.key] ? "#065f46" : "var(--text2)" }}>{a.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, justifyContent: "flex-end", background: "#fafbfc", borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)" }}>
          <button className="btn btn-out" onClick={onClose}>Cancel</button>
          <button className="btn btn-pri" onClick={handleSave}>
            {Icons.check} Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL: DELETE CONFIRM ────────────────────────────────────
function DeleteConfirmModal({ hostel, onClose, onConfirm }) {
  const [step, setStep] = useState(1);   // 1 = warning, 2 = final confirm
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await API.deleteHostel(hostel._id || hostel.id);
      onConfirm(hostel._id || hostel.id);
      onClose();
    } catch (e) {
      setError(e.message || "Failed to delete. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: step === 2 ? "#fff1f2" : undefined, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {Icons.trash}
            </div>
            <div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: "#991b1b" }}>
                {step === 1 ? "Delete Listing?" : "Are you absolutely sure?"}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{hostel.name}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body">
          {step === 1 ? (
            <>
              <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6 }}>
                You are about to permanently delete <strong>{hostel.name}</strong>. This action will:
              </p>
              <ul style={{ fontSize: 13, color: "var(--text2)", marginTop: 12, marginLeft: 20, lineHeight: 2 }}>
                <li>Remove the listing from the platform immediately</li>
                <li>Cancel all pending booking requests for this property</li>
                <li>Delete all associated photos and data</li>
              </ul>
              <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 600, marginTop: 14 }}>This cannot be undone.</p>
            </>
          ) : (
            <>
              <div style={{ padding: "16px", background: "#fff1f2", borderRadius: "var(--radius-sm)", border: "1px solid #fecaca", marginBottom: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#991b1b" }}>⚠️ Final warning</p>
                <p style={{ fontSize: 13, color: "#dc2626", marginTop: 6 }}>Once deleted, <strong>{hostel.name}</strong> and all its data will be permanently removed from the database. Students will no longer be able to find or book this property.</p>
              </div>
              {error && (
                <p style={{ fontSize: 13, color: "var(--danger)", padding: "10px 14px", background: "#fff1f2", borderRadius: "var(--radius-sm)", border: "1px solid #fecaca" }}>{error}</p>
              )}
            </>
          )}
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end", background: "#fafbfc", borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)" }}>
          <button className="btn btn-out" onClick={onClose} disabled={deleting}>Cancel</button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              {Icons.trash} Continue
            </button>
          ) : (
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: deleting ? "#9ca3af" : "#dc2626", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: deleting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              {deleting ? "Deleting..." : "Yes, Delete Permanently"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────
function DashboardPage({ setPage, setUser, bookings = [], setBookings, user }) {
  const [dashTab, setDashTab] = useState("overview");
  const [showAddHostel, setShowAddHostel] = useState(false);
  const [viewHostel, setViewHostel] = useState(null);
  const [editHostel, setEditHostel] = useState(null);
  const [deleteHostel, setDeleteHostel] = useState(null);
  const [scraperCity, setScraperCity] = useState("Bangalore");
  const [scraperStatus, setScraperStatus] = useState("idle");
  const [scraperResults, setScraperResults] = useState([]);

  // Own local state — never touches the global shared hostels pool
  const [ownerHostels, setOwnerHostels] = useState([]);

  // Load owner's real listings + bookings from MongoDB on mount
  useEffect(() => {
    API.getMyListings()
      .then(r => setOwnerHostels((r.data || []).map(mapHostel)))
      .catch(() => { });
    API.getOwnerBookings()
      .then(r => {
        const mapped = (r.data || []).map(b => ({
          ...b,
          bookingId: b.bookingRef || b.bookingId || ("SS" + String(b._id || b.id || "").slice(-8)),
          hostelId: b.hostel?._id || b.hostel || b.hostelId,
          hostelName: b.hostel?.name || b.hostelName || "",
          studentName: b.user?.fullName || b.user?.name || b.studentName || "Student",
          roomType: b.roomType,
          checkIn: b.checkInDate ? new Date(b.checkInDate).toLocaleDateString("en-IN") : "",
          totalAmount: b.totalAmount,
          paymentStatus: b.paymentStatus || "Pending",
          status: b.status || "Confirmed",
        }));
        setBookings(mapped);
      })
      .catch(() => { });
  }, []);

  const hostels = ownerHostels;            // alias for all child JSX that references `hostels`
  const setHostels = setOwnerHostels;      // alias so existing child modal props still work
  const ownerHostelsAlias = ownerHostels;
  const totalRevenue = bookings.reduce((s, b) => s + (b.totalAmount || b.monthlyRent || 0), 0);


  return (
    <div className="fade-in" style={{ height: "100vh", overflow: "hidden" }}>
      <nav className="nav">
        <NavLogo onClick={() => setPage("landing")} />
        <div className="nav-links">
          <span style={{ fontSize: 14, color: "var(--text2)" }}>Welcome, Partner Owner</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setUser(null); setPage("landing"); }}>{Icons.logout} Logout</button>
        </div>
      </nav>
      <div className="dash-layout" style={{ height: "calc(100vh - 57px)" }}>
        <div className="dash-sidebar">
          <div style={{ padding: "8px 24px 20px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>SARP Business Portal</div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>Manage your properties</div>
          </div>
          {[
            { key: "overview", icon: Icons.grid, label: "Overview" },
            { key: "listings", icon: Icons.building, label: "My Listings" },
            { key: "scraper", icon: Icons.scraper, label: "Web Scraper" },
            { key: "bookings", icon: Icons.calendar, label: "Bookings" },
            { key: "analytics", icon: Icons.trending, label: "Analytics" },
          ].map(item => (
            <button key={item.key} className={`dash-sidebar-item ${dashTab === item.key ? "active" : ""}`} onClick={() => setDashTab(item.key)}>
              {item.icon} {item.label}
            </button>
          ))}
        </div>
        <div className="dash-main">
          {dashTab === "overview" && (
            <div className="fade-up">
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Dashboard Overview</h2>
              <p style={{ color: "var(--text2)", fontSize: 14, marginBottom: 24 }}>Here's what's happening with your properties</p>
              <div className="grid-4">
                {[
                  { label: "Total Bookings", val: bookings.length, change: "", color: "var(--pri)" },
                  { label: "Revenue (MTD)", val: `₹${totalRevenue.toLocaleString()}`, change: "+8%", color: "var(--success)" },
                  { label: "Active Listings", val: ownerHostels.length, change: "", color: "var(--warn)" },
                  { label: "Avg. Rating", val: "4.5", change: "+0.2", color: "#f59e0b" },
                ].map((s, i) => (
                  <div key={i} className="card stat-card fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
                    <h4>{s.label}</h4>
                    <div className="val" style={{ color: s.color }}>{s.val}</div>
                    {s.change && <span className="change" style={{ color: "var(--success)" }}>↑ {s.change} this month</span>}
                  </div>
                ))}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: 28, marginBottom: 14 }}>Recent Bookings ({bookings.length})</h3>
              <div className="card" style={{ overflow: "hidden" }}>
                {bookings.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "var(--text3)" }}>
                    <p style={{ fontSize: 14 }}>No bookings yet. When students book, they appear here.</p>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Booking ID", "Student", "Hostel", "Move-in", "Total", "Payment"].map(col => (
                          <th key={col} style={{ padding: "12px 16px", textAlign: "left", fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.slice(0, 5).map((b, i) => {
                        const bHostel = hostels.find(x => String(x._id || x.id) === String(b.hostelId) || String(x.id) === String(b.hostelId));
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "12px 16px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--pri)", fontWeight: 700 }}>{b.bookingId || "#SS" + b.id}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14 }}>{b.studentName || "Student"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14 }}>{bHostel?.name || b.hostelName || "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, color: "var(--text2)" }}>{b.checkIn}</td>
                            <td style={{ padding: "12px 16px", fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>₹{b.totalAmount?.toLocaleString() || "—"}</td>
                            <td style={{ padding: "12px 16px" }}>
                              <span className={`badge ${b.paymentStatus === "Paid" ? "badge-success" : "badge-warn"}`}>
                                {b.paymentStatus === "Paid" ? "Paid" : "Pending"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {dashTab === "listings" && (
            <div className="fade-up">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My Listings</h2>
                  <p style={{ color: "var(--text2)", fontSize: 14 }}>{ownerHostels.length} properties listed</p>
                </div>
                <button className="btn btn-pri" onClick={() => setShowAddHostel(true)}>{Icons.plus} Add New Listing</button>
              </div>
              <div className="grid-2">
                {ownerHostels.map(h => (
                  <div key={h._id || h.id} className="card card-elevated fade-up" style={{ overflow: "hidden" }}>
                    <img src={h.images[0]} alt="" style={{ width: "100%", height: 160, objectFit: "cover" }} />
                    <div style={{ padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                        <h4 style={{ fontSize: 16, fontWeight: 700 }}>{h.name}</h4>
                        <span className={`badge ${h.availability === 0 ? "badge-danger" : h.availability > 5 ? "badge-success" : "badge-warn"}`}>
                          {h.availability === 0 ? "🔴 Fully Booked" : `${h.availability} rooms free`}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{h.address}</p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--pri)" }}>₹{h.price.toLocaleString()}/mo</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" title="Edit listing" onClick={() => setEditHostel(h)}>{Icons.edit}</button>
                          <button className="btn btn-ghost btn-sm" title="View amenities" onClick={() => setViewHostel(h)}>{Icons.eye}</button>
                          <button className="btn btn-danger btn-sm" title="Delete hostel" onClick={() => setDeleteHostel(h)}>{Icons.trash}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dashTab === "scraper" && (
            <div className="fade-up">
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Web Scraper</h2>
              <p className="section-sub">Extract public hostel data from the web to import into your listings</p>
              <div className="card" style={{ padding: 24, marginBottom: 24 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <div className="input-wrap" style={{ flex: 1, maxWidth: 300 }}>
                    <label>Target City</label>
                    <input className="input" value={scraperCity} onChange={e => setScraperCity(e.target.value)} placeholder="e.g. Bangalore, Mumbai" />
                  </div>
                  <button className="btn btn-pri" disabled={scraperStatus === "loading"} onClick={async () => {
                    setScraperStatus("loading");
                    try {
                      const res = await fetch("/api/scraper/run", {
                        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: scraperCity })
                      });
                      const data = await res.json();
                      if (data.success && data.data) { setScraperResults(data.data); setScraperStatus("success"); }
                      else setScraperStatus("error");
                    } catch { setScraperStatus("error"); }
                  }}>
                    {scraperStatus === "loading" ? "Scraping..." : "Scrape Public Listings"}
                  </button>
                </div>
                {scraperStatus === "loading" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, color: "var(--pri)" }}>
                    <div className="chat-typing"><span /><span /><span /></div> Scraping live data...
                  </div>
                )}
                {scraperStatus === "error" && <p style={{ color: "var(--danger)", marginTop: 16 }}>Failed to scrape data. Is the backend running?</p>}
                {scraperStatus === "success" && <p style={{ color: "var(--success)", marginTop: 16, display: "flex", alignItems: "center", gap: 6 }}>{Icons.check} Successfully scraped {scraperResults.length} properties!</p>}
              </div>
              {scraperResults.length > 0 && (
                <div className="grid-2">
                  {scraperResults.map((h, i) => (
                    <div key={i} className="card card-elevated fade-up" style={{ animationDelay: `${i * 0.1}s`, overflow: "hidden" }}>
                      <img src={h.images[0]} alt="" style={{ width: "100%", height: 160, objectFit: "cover" }} />
                      <div style={{ padding: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <h4 style={{ fontSize: 16, fontWeight: 700 }}>{h.name}</h4>
                          <span className="badge badge-pri">New</span>
                        </div>
                        <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{h.address}, {h.city}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                          <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--pri)" }}>₹{h.price.toLocaleString()}/mo</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>⭐ {h.rating}</span>
                        </div>
                        <button className="btn btn-out btn-sm btn-full" onClick={() => {
                          setHostels(prev => [{ ...h, id: prev.length + 1, owner: "owner1" }, ...prev]);
                          setScraperResults(prev => prev.filter((_, idx) => idx !== i));
                        }}>{Icons.plus} Import to My Listings</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {dashTab === "bookings" && (
            <BookingManagementTab
              bookings={bookings}
              setBookings={setBookings}
              hostels={hostels}
              setHostels={setHostels}
            />
          )}

          {dashTab === "analytics" && (
            <div className="fade-up">
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Analytics</h2>
              <p className="section-sub">Performance insights for your properties</p>
              <div className="grid-3" style={{ marginBottom: 24 }}>
                {[
                  { label: "Occupancy Rate", val: ownerHostels.length > 0 ? Math.round((bookings.length / ownerHostels.reduce((s, h) => s + h.totalRooms, 0)) * 100) + "%" : "0%", sub: "Across all properties", color: "var(--pri)" },
                  { label: "Revenue (Paid)", val: "₹" + bookings.filter(b => b.paymentStatus === "Paid").reduce((s, b) => s + (b.totalAmount || 0), 0).toLocaleString(), sub: "From paid bookings", color: "var(--success)" },
                  { label: "Avg. Rating", val: ownerHostels.length > 0 ? (ownerHostels.reduce((s, h) => s + h.rating, 0) / ownerHostels.length).toFixed(1) + " / 5" : "—", sub: "Across your listings", color: "#f59e0b" },
                ].map((s, i) => (
                  <div key={i} className="card stat-card fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
                    <h4>{s.label}</h4>
                    <div className="val" style={{ color: s.color }}>{s.val}</div>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>{s.sub}</span>
                  </div>
                ))}
              </div>
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Monthly Revenue Trend</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 200 }}>
                  {[65, 72, 58, 80, 95, 88, 92, 78, 85, 90, 98, 105].map((v, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ width: "100%", height: `${v * 1.8}px`, background: "linear-gradient(to top, var(--pri), rgba(13,148,136,0.3))", borderRadius: "6px 6px 0 0", minHeight: 20 }} />
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>{"JFMAMJJASOND"[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {showAddHostel && (
        <AddHostelModal hostels={hostels} setHostels={setHostels} onClose={() => setShowAddHostel(false)} />
      )}
      {viewHostel && (
        <ViewAmenitiesModal hostel={viewHostel} onClose={() => setViewHostel(null)} />
      )}
      {editHostel && (
        <EditAmenitiesModal hostel={editHostel} setHostels={setHostels} onClose={() => setEditHostel(null)} />
      )}
      {deleteHostel && (
        <DeleteConfirmModal
          hostel={deleteHostel}
          onClose={() => setDeleteHostel(null)}
          onConfirm={(id) => setHostels(prev => prev.filter(h => (h._id || h.id) !== id))}
        />
      )}
    </div>
  );
}

// ─── COMPONENT: CHAT WIDGET (Claude API) ─────────────────────
function ChatWidget({ hostels, userLoc, setSelectedHostel, setPage }) {
  const [showChat, setShowChat] = useState(false);
  const locKnown = !!userLoc;
  const [chatMsgs, setChatMsgs] = useState([{
    from: "bot",
    text: "Hi! I'm your SARP AI Assistant 👋\n\nDetecting your location... One moment!",
  }]);

  // Update greeting once location is known
  useEffect(() => {
    setChatMsgs([{
      from: "bot",
      text: userLoc
        ? "Hi! I'm your SARP AI Assistant 👋\n\n📍 Location detected! Tell me your budget, amenities, or room type and I'll find the best student accommodation near you."
        : "Hi! I'm your SARP AI Assistant 👋\n\nGPS unavailable, but I can still help! Tell me your budget, preferred amenities, or room type and I'll recommend the best match.",
    }]);
  }, [userLoc]);
  // conversationHistory tracks messages in Claude API format {role, content}
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const chatBodyRef = useRef(null);

  useEffect(() => {
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [chatMsgs, chatTyping]);

  const handleChatSend = () => {
    const msg = chatInput.trim();
    if (!msg || chatTyping) return;

    setChatMsgs(prev => [...prev, { from: "user", text: msg }]);
    setChatInput("");
    setChatTyping(true);

    // Small delay so typing indicator shows — feels natural
    setTimeout(() => {
      const { text, hostelId } = buildLocalReply(msg, hostels, userLoc, conversationHistory);
      setChatMsgs(prev => [...prev, {
        from: "bot",
        text,
        hostelLink: hostelId || null,
      }]);
      setConversationHistory(prev => [
        ...prev,
        { role: "user", content: msg },
        { role: "assistant", content: text },
      ]);
      setChatTyping(false);
    }, 600);
  };

  return (
    <>
      <button className="chat-fab" onClick={() => setShowChat(!showChat)}>
        {showChat ? Icons.x : Icons.sparkle}
      </button>
      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {Icons.bot}
            </div>
            <div>
              <h3>SARP AI Assistant</h3>
              <p>{locKnown ? "📍 Location detected · Local AI" : "⚠️ Location unavailable · Local AI"}</p>
            </div>
            <button style={{ marginLeft: "auto", background: "none", border: "none", color: "#fff", cursor: "pointer" }} onClick={() => setShowChat(false)}>
              {Icons.x}
            </button>
          </div>

          <div className="chat-body" ref={chatBodyRef}>
            {chatMsgs.map((m, i) => (
              <div key={i}>
                <div className={`chat-msg ${m.from}`} style={{ whiteSpace: "pre-wrap" }}>
                  {m.text}
                </div>
                {m.hostelLink && (
                  <button
                    className="btn btn-pri btn-sm"
                    style={{ marginTop: 6, alignSelf: "flex-start" }}
                    onClick={() => {
                      const h = hostels.find(x => x.id === m.hostelLink || x._id === m.hostelLink);
                      if (h) { setSelectedHostel(h); setPage("detail"); setShowChat(false); }
                    }}
                  >
                    View Details →
                  </button>
                )}
              </div>
            ))}
            {chatTyping && (
              <div className="chat-typing"><span /><span /><span /></div>
            )}
          </div>

          <div className="chat-input-row">
            <input
              className="input"
              placeholder="e.g. I need AC and food under ₹7k..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleChatSend()}
              disabled={chatTyping}
            />
            <button
              className="btn btn-pri btn-sm"
              onClick={handleChatSend}
              disabled={chatTyping || !chatInput.trim()}
              style={{ padding: "10px 12px" }}
            >
              {Icons.send}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function SmartStay() {
  const [hostels, setHostels] = useState([]);
  const [page, setPage] = useState("landing");
  const [userType, setUserType] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(null);
  const [selectedHostel, setSelectedHostel] = useState(null);
  const [pendingFilters, setPendingFilters] = useState({ maxPrice: 0, maxDist: 0 });
  const [appliedFilters, setAppliedFilters] = useState(null); // null = no filter, show everything
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [compareList, setCompareList] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [bookingHostel, setBookingHostel] = useState(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState([]);
  const [bookings, setBookings] = useState([]);

  const [userLoc, setUserLoc] = useState(null);
  const [locStatus, setLocStatus] = useState("Detecting your location...");

  // ── Restore session on mount ──
  useEffect(() => {
    const token = localStorage.getItem("sarp_token");
    if (token) {
      API.getMe().then(res => {
        const u = res.data;
        setUser({ name: u.fullName, type: u.role, _id: u._id, email: u.email });
        setUserType(u.role);
        // ✅ Navigate back to the correct page after refresh
        setPage(u.role === "business" ? "dashboard" : "explore");
      }).catch(() => localStorage.removeItem("sarp_token"));
    }
  }, []);


  // ── Load all hostels when arriving at explore page ──
  useEffect(() => {
    if (page === "explore") {
      API.getAllHostels(userLoc?.lat, userLoc?.lng)
        .then(res => { if (res.success) setHostels((res.data || []).map(mapHostel)); })
        .catch(() => { });
    }
  }, [page, userLoc]);

  // ── Load student bookings when arriving at mybookings page ──
  useEffect(() => {
    if (page === "mybookings") {
      API.getMyBookings().then(res => {
        const mapped = (res.data || []).map(b => ({
          ...b,
          bookingId: b.bookingRef || b.bookingId || ("SS" + String(b._id || b.id || "").slice(-8)),
          hostelId: b.hostel?._id || b.hostel || b.hostelId,
          hostelName: b.hostelName || b.hostel?.name || "",
          roomType: b.roomType,
          checkIn: b.checkInDate ? new Date(b.checkInDate).toLocaleDateString("en-IN") : "",
          totalAmount: b.totalAmount,
          paymentStatus: b.paymentStatus || "Pending",
          status: b.status || "Confirmed",
        }));
        setBookings(mapped);
      }).catch(() => { });
    }
  }, [page]);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSy_YOUR_API_KEY_HERE",
  });

  const onMapLoad = useCallback((map) => { }, []);
  const onMapUnmount = useCallback(() => { }, []);

  const requestLocation = useCallback(() => {
    setLocStatus("Detecting your location...");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocStatus("📍 Using your current location for measurements");
        },
        () => {
          setLocStatus("⚠️ Location access denied. Using default Bangalore location.");
          setUserLoc({ lat: 12.9716, lng: 77.5946 });
        }
      );
    } else {
      setLocStatus("⚠️ Geolocation not supported. Using default location.");
      setUserLoc({ lat: 12.9716, lng: 77.5946 });
    }
  }, []);

  useEffect(() => {
    if (page === "explore" && !userLoc) requestLocation();
  }, [page, userLoc, requestLocation]);

  // ── Computed hostels with real distances ──
  const hostelsWithDistances = hostels.map(h => {
    // Hostels with no GPS (lat/lng null/0) — distance unknown, show them at bottom
    const hasLocation = h.lat && h.lng && h.lat !== 0 && h.lng !== 0;
    const dist = (hasLocation && userLoc)
      ? getDistance(userLoc.lat, userLoc.lng, h.lat, h.lng)
      : (h.distance || null);
    return { ...h, distance: dist !== null ? parseFloat(dist.toFixed(1)) : null, hasLocation };
  });

  const filteredHostels = hostelsWithDistances.filter(h => {
    // Hide fully-booked hostels — no rooms means nothing to show students
    if (h.availability === 0) return false;
    // Price filter — 0 means no limit
    if (appliedFilters && appliedFilters.maxPrice > 0 && h.price > appliedFilters.maxPrice) return false;
    // Distance filter — 0 means no limit; only when hostel has GPS + user loc known
    if (appliedFilters && appliedFilters.maxDist > 0 && h.hasLocation && h.distance !== null && userLoc && h.distance > appliedFilters.maxDist) return false;
    // Search query always active
    if (searchQuery && !h.name.toLowerCase().includes(searchQuery.toLowerCase()) && !h.address.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    // Sort nearest first; hostels with no GPS go to the bottom
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });

  const toggleCompare = (id) => setCompareList(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev);
  const toggleFav = (id) => setFavorites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── handleLogin — called from AuthPage after successful API login ──
  const handleLogin = (userData) => {
    setUser({ name: userData.fullName, type: userData.role, _id: userData._id, email: userData.email });
    setUserType(userData.role);
    setPage(userData.role === "student" ? "explore" : "dashboard");
  };

  // ── handleLogout — clears token + resets state ──
  const handleLogout = () => {
    localStorage.removeItem("sarp_token");
    setUser(null);
    setUserType(null);
    setHostels([]);
    setBookings([]);
    setPage("landing");
  };

  // ── handleConfirmBooking — calls createBooking API ──
  const handleConfirmBooking = async (hostel, bookingDetails) => {
    try {
      const checkInDate = bookingDetails.moveIn || new Date().toISOString().slice(0, 10);
      const roomType = bookingDetails.roomType || hostel.roomTypes[0];
      const res = await API.createBooking({
        hostelId: hostel._id || hostel.id,
        roomType,
        checkInDate,
      });
      const booking = res.data;
      const gst = Math.round(hostel.price * 0.03);
      const totalWithDeposit = hostel.price + gst + 199 + hostel.deposit;
      return {
        ...hostel,
        roomType,
        moveIn: checkInDate,
        bookingId: booking.bookingRef || "#SS" + Date.now().toString().slice(-6),
        totalWithDeposit,
      };
    } catch (e) {
      // Even on error, show the confirmation UI with calculated amounts
      const gst = Math.round(hostel.price * 0.03);
      const totalWithDeposit = hostel.price + gst + 199 + hostel.deposit;
      return {
        ...hostel,
        roomType: bookingDetails.roomType || hostel.roomTypes[0],
        moveIn: bookingDetails.moveIn || new Date().toISOString().slice(0, 10),
        bookingId: "#SS" + Date.now().toString().slice(-6),
        totalWithDeposit,
      };
    }
  };

  return (
    <>
      <style>{css}</style>

      <div className="app">
        {page === "landing" && (
          <LandingPage setPage={setPage} setUserType={setUserType} setAuthMode={setAuthMode} />
        )}
        {page === "auth" && (
          <AuthPage
            userType={userType}
            authMode={authMode}
            setAuthMode={setAuthMode}
            setPage={setPage}
            onLogin={handleLogin}
          />
        )}
        {page === "explore" && (
          <ExplorePage
            filteredHostels={filteredHostels}
            pendingFilters={pendingFilters}
            setPendingFilters={setPendingFilters}
            appliedFilters={appliedFilters}
            setAppliedFilters={setAppliedFilters}
            showFilterPanel={showFilterPanel}
            setShowFilterPanel={setShowFilterPanel}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            compareList={compareList}
            favorites={favorites}
            toggleCompare={toggleCompare}
            toggleFav={toggleFav}
            userLoc={userLoc}
            locStatus={locStatus}
            requestLocation={requestLocation}
            isLoaded={isLoaded}
            onMapLoad={onMapLoad}
            onMapUnmount={onMapUnmount}
            setPage={setPage}
            setSelectedHostel={setSelectedHostel}
            setUser={handleLogout}
            setShowCompare={setShowCompare}
          />
        )}
        {page === "detail" && (
          <DetailPage
            selectedHostel={selectedHostel}
            setPage={setPage}
            setBookingHostel={async (hostel) => {
              const finalBooking = await handleConfirmBooking(hostel, hostel);
              setBookingHostel(finalBooking);
            }}
            setBookingConfirmed={setBookingConfirmed}
          />
        )}
        {page === "mybookings" && (
          <MyBookingsPage hostels={hostels} bookings={bookings} setPage={setPage} setUser={handleLogout} />
        )}
        {page === "dashboard" && (
          <DashboardPage setPage={setPage} setUser={handleLogout} bookings={bookings} setBookings={setBookings} user={user} />
        )}

        {showCompare && (
          <CompareModal compareList={compareList} hostels={hostelsWithDistances} onClose={() => setShowCompare(false)} />
        )}
        {bookingConfirmed && (
          <BookingConfirmedModal
            bookingHostel={bookingHostel}
            onClose={() => setBookingConfirmed(false)}
            setPage={setPage}
          />
        )}

        {user && user.type === "student" && (
          <ChatWidget hostels={hostels} userLoc={userLoc} setSelectedHostel={setSelectedHostel} setPage={setPage} />
        )}
      </div>
    </>
  );
}
