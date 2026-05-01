import { useState, useMemo, useRef, useEffect } from "react";

// ─── Mock Data ───────────────────────────────────────────────────────────────
const MAPS = {
  altis:     { name: "Altis",     color: "#4A9EFF", terrain: "Mediterranean island" },
  gulfcoast: { name: "Gulfcoast", color: "#2DD4A0", terrain: "Coastal wetlands" },
  tanoa:     { name: "Tanoa",     color: "#FF9F43", terrain: "Pacific jungle" },
  stratis:   { name: "Stratis",   color: "#A78BFA", terrain: "Small island" },
  livonia:   { name: "Livonia",   color: "#FFB84A", terrain: "Eastern European forest" },
};

const TAGS = ["TvT", "COOP", "Zeus", "Training"];

const STATUS = {
  ready:      { label: "Ready",      color: "#2DD4A0", icon: "●" },
  streaming:  { label: "Streaming",  color: "#4A9EFF", icon: "◉" },
  converting: { label: "Converting", color: "#FFB84A", icon: "◌" },
  pending:    { label: "Pending",    color: "#667788", icon: "○" },
  failed:     { label: "Failed",     color: "#FF4A4A", icon: "✕" },
};

const MISSIONS = [
  { id: 1,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-08", duration: "7m 21s",     durationSec: 441,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 12, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 24, kills: 8 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 1, kills: 3 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } },
    playerList: [
      { uid: "76561198001", name: "Cameron Thomson", side: "BLUFOR", kills: 4, deaths: 0, markers: 2 },
      { uid: "76561198002", name: "Jake O'Connor", side: "BLUFOR", kills: 3, deaths: 0, markers: 1 },
      { uid: "76561198003", name: "Owen King", side: "BLUFOR", kills: 1, deaths: 1, markers: 0 },
      { uid: "76561198004", name: "Jack Reed", side: "BLUFOR", kills: 0, deaths: 0, markers: 0 },
      { uid: "76561198005", name: "Liam Walsh", side: "BLUFOR", kills: 0, deaths: 0, markers: 0 },
      { uid: "76561198006", name: "Sean Murray", side: "BLUFOR", kills: 0, deaths: 1, markers: 0 },
      { uid: "76561198007", name: "Daniel Hayes", side: "BLUFOR", kills: 0, deaths: 0, markers: 3 },
      { uid: "76561198008", name: "Ryan Kelly", side: "BLUFOR", kills: 0, deaths: 0, markers: 0 },
      { uid: "76561198009", name: "Patrick Moore", side: "BLUFOR", kills: 0, deaths: 0, markers: 0 },
      { uid: "76561198010", name: "xX_MarkerSpam_Xx", side: "BLUFOR", kills: 0, deaths: 2, markers: 47 },
      { uid: "76561198011", name: "Chris O'Brien", side: "BLUFOR", kills: 0, deaths: 0, markers: 0 },
      { uid: "76561198012", name: "Declan Murphy", side: "BLUFOR", kills: 0, deaths: 0, markers: 1 },
    ],
  },
  { id: 2,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-08", duration: "6m 15s",     durationSec: 375,  tag: "TvT",  status: "ready",      players: 34, kills: 8,  sides: { BLUFOR: { total: 28, players: 10, ai: 18, alive: 22, kills: 5 }, OPFOR: { total: 4, players: 0, ai: 4, alive: 2, kills: 2 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 3,  name: "C6M5 - Commies",    map: "gulfcoast", date: "2026-01-31", duration: "2h 58m 27s", durationSec: 10707, tag: "COOP", storageFormat: "protobuf", status: "streaming",  players: 63, kills: 1245, sides: { WEST: { total: 19, players: 19, ai: 0, alive: 8, kills: 1088 }, EAST: { total: 1331, players: 0, ai: 1331, alive: 243, kills: 97 }, GUER: { total: 84, players: 0, ai: 84, alive: 24, kills: 60 }, CIV: { total: 19, players: 0, ai: 19, alive: 16, kills: 0 } },
    playerList: [
      { uid: "76561198001", name: "Cameron Thomson", side: "WEST", kills: 127, deaths: 1, markers: 5 },
      { uid: "76561198002", name: "Jake O'Connor", side: "WEST", kills: 98, deaths: 0, markers: 3 },
      { uid: "76561198003", name: "Owen King", side: "WEST", kills: 84, deaths: 0, markers: 2 },
      { uid: "76561198004", name: "Jack Reed", side: "WEST", kills: 72, deaths: 1, markers: 1 },
      { uid: "76561198005", name: "Liam Walsh", side: "WEST", kills: 68, deaths: 0, markers: 0 },
      { uid: "76561198006", name: "Sean Murray", side: "WEST", kills: 61, deaths: 1, markers: 0 },
      { uid: "76561198007", name: "Daniel Hayes", side: "WEST", kills: 55, deaths: 0, markers: 4 },
      { uid: "76561198008", name: "Ryan Kelly", side: "WEST", kills: 52, deaths: 1, markers: 0 },
      { uid: "76561198009", name: "Patrick Moore", side: "WEST", kills: 49, deaths: 0, markers: 0 },
      { uid: "76561198010", name: "xX_MarkerSpam_Xx", side: "WEST", kills: 41, deaths: 2, markers: 83 },
      { uid: "76561198011", name: "Chris O'Brien", side: "WEST", kills: 45, deaths: 0, markers: 1 },
      { uid: "76561198012", name: "Declan Murphy", side: "WEST", kills: 38, deaths: 0, markers: 0 },
      { uid: "76561198013", name: "Conor Byrne", side: "WEST", kills: 36, deaths: 0, markers: 0 },
      { uid: "76561198014", name: "Michael Doyle", side: "WEST", kills: 34, deaths: 1, markers: 0 },
      { uid: "76561198015", name: "Brian Fitzgerald", side: "WEST", kills: 32, deaths: 0, markers: 0 },
      { uid: "76561198016", name: "Niall Gallagher", side: "WEST", kills: 28, deaths: 0, markers: 0 },
      { uid: "76561198017", name: "Tom Brennan", side: "WEST", kills: 25, deaths: 0, markers: 0 },
      { uid: "76561198018", name: "Eoin Casey", side: "WEST", kills: 22, deaths: 1, markers: 0 },
      { uid: "76561198019", name: "Cathal Nolan", side: "WEST", kills: 21, deaths: 0, markers: 0 },
    ],
  },
  { id: 4,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-04", duration: "6m 42s",     durationSec: 402,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 15, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 20, kills: 10 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 0, kills: 4 }, IND: { total: 2, players: 0, ai: 2, alive: 1, kills: 1 } } },
  { id: 5,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-04", duration: "8m 58s",     durationSec: 538,  tag: "TvT",  status: "streaming",  players: 36, kills: 22, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 18, kills: 14 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 0, kills: 6 }, IND: { total: 2, players: 0, ai: 2, alive: 1, kills: 2 } } },
  { id: 6,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-04", duration: "7m 38s",     durationSec: 458,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 11, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 26, kills: 7 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 1, kills: 3 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 7,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-04", duration: "9m 16s",     durationSec: 556,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 19, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 16, kills: 12 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 0, kills: 5 }, IND: { total: 2, players: 0, ai: 2, alive: 0, kills: 2 } } },
  { id: 8,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "8m 4s",      durationSec: 484,  tag: "TvT",  storageFormat: "json", status: "converting", players: 36, kills: 14, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 22, kills: 9 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 1, kills: 4 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 9,  name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "7m 30s",     durationSec: 450,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 9,  sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 27, kills: 6 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 2, kills: 2 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 10, name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "8m 57s",     durationSec: 537,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 17, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 19, kills: 11 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 0, kills: 5 }, IND: { total: 2, players: 0, ai: 2, alive: 1, kills: 1 } } },
  { id: 11, name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "8m 47s",     durationSec: 527,  tag: "TvT",  storageFormat: "json", status: "failed",     players: 36, kills: 13, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 23, kills: 8 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 1, kills: 4 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 12, name: "OP Ironclad",       map: "tanoa",     date: "2026-01-28", duration: "1h 42m 11s", durationSec: 6131, tag: "COOP", status: "ready",      players: 52, kills: 94, sides: { BLUFOR: { total: 52, players: 24, ai: 28, alive: 38, kills: 87 }, OPFOR: { total: 180, players: 0, ai: 180, alive: 93, kills: 7 } } },
  { id: 13, name: "Zeus Night Ops",    map: "livonia",   date: "2026-01-25", duration: "3h 12m 05s", durationSec: 11525, tag: "Zeus", status: "ready",      players: 28, kills: 67, sides: { BLUFOR: { total: 28, players: 28, ai: 0, alive: 19, kills: 62 }, OPFOR: { total: 95, players: 0, ai: 95, alive: 33, kills: 5 } } },
  { id: 14, name: "Basic Rifle Range", map: "stratis",   date: "2026-01-20", duration: "45m 33s",    durationSec: 2733, tag: "Training", status: "ready",  players: 12, kills: 0,  sides: { BLUFOR: { total: 12, players: 12, ai: 0, alive: 12, kills: 0 } } },
  { id: 15, name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "6m 26s",     durationSec: 386,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 7,  sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 28, kills: 4 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 2, kills: 2 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
  { id: 16, name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "8m 6s",      durationSec: 486,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 16, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 20, kills: 10 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 0, kills: 5 }, IND: { total: 2, players: 0, ai: 2, alive: 1, kills: 1 } } },
  { id: 17, name: "MP_COOP_m05",       map: "altis",     date: "2026-02-03", duration: "7m 38s",     durationSec: 458,  tag: "TvT",  storageFormat: "protobuf", status: "ready",      players: 36, kills: 10, sides: { BLUFOR: { total: 31, players: 12, ai: 19, alive: 25, kills: 6 }, OPFOR: { total: 3, players: 0, ai: 3, alive: 1, kills: 3 }, IND: { total: 2, players: 0, ai: 2, alive: 2, kills: 1 } } },
];

const SIDE_COLORS = {
  BLUFOR: "#4A9EFF",
  OPFOR:  "#FF4A4A",
  IND:    "#2DD4A0",
  CIV:    "#A78BFA",
  WEST:   "#4A9EFF",
  EAST:   "#FF4A4A",
  GUER:   "#2DD4A0",
};

// ─── Icons ───────────────────────────────────────────────────────────────────
const Icons = {
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Calendar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Users: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Crosshair: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>,
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>,
  Map: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Tag: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>,
  ArrowRight: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  Globe: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Zap: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  SortAsc: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M12 5v14M5 12l7 7 7-7"/></svg>,
  SortDesc: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M12 19V5M5 12l7-7 7 7"/></svg>,
  GitHub: () => <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>,
  ExternalLink: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  Heart: () => <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Steam: () => <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M11.979 0C5.678 0 .511 4.86.022 10.942l6.432 2.658a3.387 3.387 0 0 1 1.912-.588c.063 0 .125.002.188.006l2.861-4.142V8.77a4.508 4.508 0 0 1 4.505-4.505 4.508 4.508 0 0 1 4.505 4.505 4.508 4.508 0 0 1-4.505 4.506h-.105l-4.077 2.91c0 .053.003.106.003.16a3.39 3.39 0 0 1-3.388 3.388 3.393 3.393 0 0 1-3.349-2.868L.2 15.099A11.979 11.979 0 0 0 11.979 24c6.627 0 12-5.373 12-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61a2.54 2.54 0 0 0 4.867-.863 2.542 2.542 0 0 0-2.537-2.54 2.54 2.54 0 0 0-.946.183l1.522.63a1.868 1.868 0 0 1-1.433 3.2zm8.38-6.249a3.005 3.005 0 0 0 3.002-3.002 3.005 3.005 0 0 0-3.002-3.002 3.005 3.005 0 0 0-3.003 3.002 3.005 3.005 0 0 0 3.003 3.002z"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  Edit: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Upload: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  RefreshCw: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  Shield: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  LogOut: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  AlertTriangle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>,
  Eye: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  EyeOff: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  MapPin: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  Flag: () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" width="10" height="10"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" strokeWidth="2" fill="none"/></svg>,
  FilePlus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
};

// ─── Tag Colors ──────────────────────────────────────────────────────────────
const TAG_COLORS = {
  TvT:      { bg: "rgba(255,74,74,0.12)",  color: "#FF6B6B",  border: "rgba(255,74,74,0.2)" },
  COOP:     { bg: "rgba(74,158,255,0.12)", color: "#6BB3FF",  border: "rgba(74,158,255,0.2)" },
  Zeus:     { bg: "rgba(167,139,250,0.12)", color: "#B5A3FA", border: "rgba(167,139,250,0.2)" },
  Training: { bg: "rgba(255,184,74,0.12)",  color: "#FFC66B", border: "rgba(255,184,74,0.2)" },
};

const LANGUAGES = [
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "ru", label: "Русский",  flag: "🇷🇺" },
  { code: "cs", label: "Čeština",  flag: "🇨🇿" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function relativeDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date("2026-02-11");
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

// ─── Side Dots ───────────────────────────────────────────────────────────────
function SideDots({ sides }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Object.entries(sides).map(([side, data]) => (
        <div key={side} style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 6, height: 6, borderRadius: 2, background: SIDE_COLORS[side] || "#666" }}/>
          <span style={{ fontSize: 10, color: "#667788", fontFamily: "'JetBrains Mono', monospace" }}>{data.total}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
      color: s.color, fontWeight: 500,
    }}>
      <span style={{
        fontSize: status === "converting" ? 10 : 8,
        animation: status === "converting" ? "spin 2s linear infinite" : status === "streaming" ? "pulse 2s ease-in-out infinite" : "none",
      }}>{s.icon}</span>
      {s.label}
    </div>
  );
}

// ─── Tag Badge ───────────────────────────────────────────────────────────────
function TagBadge({ tag, clickable, active, onClick }) {
  const tc = TAG_COLORS[tag] || { bg: "rgba(255,255,255,0.06)", color: "#667788", border: "rgba(255,255,255,0.1)" };
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
      fontWeight: 600, letterSpacing: "0.04em",
      color: active !== false ? tc.color : "#445566",
      background: active !== false ? tc.bg : "rgba(255,255,255,0.02)",
      border: `1px solid ${active !== false ? tc.border : "rgba(255,255,255,0.05)"}`,
      borderRadius: 6, padding: "4px 10px",
      cursor: clickable ? "pointer" : "default",
      transition: "all 0.2s",
    }}>
      {tag}
    </button>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────
function StatPill({ icon, value, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#c8d4e0" }}>
        <span style={{ color: "#556677" }}>{icon}</span>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
      </div>
      <span style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}


// ─── Mission Card Row ────────────────────────────────────────────────────────
function MissionRow({ mission, selected, onSelect, onLaunch, style: animStyle }) {
  const mapData = MAPS[mission.map] || { name: mission.map, color: "#667" };
  const isReady = mission.status === "ready" || mission.status === "streaming";

  return (
    <div
      onClick={() => onSelect(mission.id)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 100px 90px 80px 70px 100px",
        alignItems: "center",
        gap: 0,
        padding: "14px 20px",
        cursor: "pointer",
        background: selected ? "rgba(74,158,255,0.06)" : "transparent",
        borderLeft: selected ? "2px solid #4A9EFF" : "2px solid transparent",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        transition: "all 0.15s ease",
        ...animStyle,
      }}
    >
      {/* Mission Name */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: `linear-gradient(135deg, ${mapData.color}22, ${mapData.color}08)`,
          border: `1px solid ${mapData.color}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: mapData.color, fontSize: 10,
        }}>
          <Icons.Globe />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: "#e0e6ed",
            fontFamily: "'Outfit', sans-serif",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {mission.name}
          </div>
          <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
            {mapData.name}
          </div>
        </div>
      </div>

      {/* Date */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 12, color: "#99aabb", fontFamily: "'JetBrains Mono', monospace" }}>
          {formatDate(mission.date)}
        </span>
        <span style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>
          {relativeDate(mission.date)}
        </span>
      </div>

      {/* Duration */}
      <div style={{ fontSize: 12, color: "#8899aa", fontFamily: "'JetBrains Mono', monospace" }}>
        {mission.duration}
      </div>

      {/* Players */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ color: "#556677" }}><Icons.Users /></span>
        <span style={{ fontSize: 12, color: "#8899aa", fontFamily: "'JetBrains Mono', monospace" }}>
          {mission.players}
        </span>
      </div>

      {/* Kills */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ color: "#FF4A4A88" }}><Icons.Crosshair /></span>
        <span style={{ fontSize: 12, color: mission.kills > 0 ? "#FF6B6B" : "#445566", fontFamily: "'JetBrains Mono', monospace" }}>
          {mission.kills}
        </span>
      </div>

      {/* Tag */}
      <TagBadge tag={mission.tag} />

      {/* Status + Launch */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        <StatusBadge status={mission.status} />
        {isReady && selected && (
          <button
            onClick={(e) => { e.stopPropagation(); onLaunch(mission); }}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: "linear-gradient(135deg, #4A9EFF, #3585dd)",
              border: "none", cursor: "pointer",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 12px rgba(74,158,255,0.3)",
              animation: "fadeScale 0.2s ease-out",
            }}
          >
            <Icons.Play />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Detail Sidebar ──────────────────────────────────────────────────────────
function DetailSidebar({ mission, onLaunch, onClose, isAdmin, onEdit, onDelete, onRetry }) {
  if (!mission) return null;
  const mapData = MAPS[mission.map] || { name: mission.map, color: "#667", terrain: "Unknown" };
  const isReady = mission.status === "ready" || mission.status === "streaming";

  return (
    <div style={{
      width: 340, flexShrink: 0,
      background: "rgba(13,21,32,0.6)",
      borderLeft: "1px solid rgba(255,255,255,0.06)",
      display: "flex", flexDirection: "column",
      animation: "slideInRight 0.25s ease-out",
      overflow: "hidden",
    }}>
      {/* Map Hero */}
      <div style={{
        height: 160, position: "relative",
        background: `linear-gradient(135deg, ${mapData.color}15, ${mapData.color}05)`,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}>
        {/* Grid pattern */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.06 }}>
          <defs>
            <pattern id="detailGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={mapData.color} strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#detailGrid)"/>
        </svg>
        {/* Contour shapes */}
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.08 }}>
          <ellipse cx="50%" cy="50%" rx="80" ry="50" fill="none" stroke={mapData.color} strokeWidth="1"/>
          <ellipse cx="50%" cy="50%" rx="120" ry="75" fill="none" stroke={mapData.color} strokeWidth="0.7"/>
          <ellipse cx="50%" cy="50%" rx="160" ry="100" fill="none" stroke={mapData.color} strokeWidth="0.5"/>
        </svg>
        <div style={{ textAlign: "center", zIndex: 1 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: mapData.color, fontFamily: "'Outfit', sans-serif", opacity: 0.8 }}>
            {mapData.name}
          </div>
          <div style={{ fontSize: 11, color: "#556677", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
            {mapData.terrain}
          </div>
        </div>
        <button onClick={onClose} style={{
          position: "absolute", top: 10, right: 10,
          width: 28, height: 28, borderRadius: 6,
          background: "rgba(0,0,0,0.3)", border: "none",
          cursor: "pointer", color: "#667788",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icons.X />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
        {/* Title */}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif", marginBottom: 4 }}>
            {mission.name}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <TagBadge tag={mission.tag} />
            <StatusBadge status={mission.status} />
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12,
          padding: 16, borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}>
          <StatPill icon={<Icons.Calendar />} value={formatDate(mission.date)} label="DATE" />
          <StatPill icon={<Icons.Clock />} value={mission.duration} label="DURATION" />
          <StatPill icon={<Icons.Users />} value={mission.players} label="PLAYERS" />
        </div>

        {/* Sides Breakdown — each side as a self-contained stat card */}
        <div>
          <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 10 }}>
            FORCE COMPOSITION
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(mission.sides).map(([side, data]) => {
              const color = SIDE_COLORS[side] || "#667788";
              const dead = data.total - data.alive;
              return (
                <div key={side} style={{
                  padding: "10px 12px", borderRadius: 8,
                  background: `${color}08`,
                  border: `1px solid ${color}18`,
                }}>
                  {/* Side header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>
                      <span style={{ fontSize: 12, color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                        {side}
                      </span>
                    </div>
                    {data.players > 0 ? (
                      <span style={{
                        fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                        color: "#4A9EFF", background: "rgba(74,158,255,0.1)",
                        padding: "2px 7px", borderRadius: 3, letterSpacing: "0.02em",
                      }}>
                        {data.players} player{data.players !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
                        color: "#556677", background: "rgba(255,255,255,0.04)",
                        padding: "2px 7px", borderRadius: 3,
                      }}>
                        AI only
                      </span>
                    )}
                  </div>

                  {/* Stat grid — every number labeled */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                    {[
                      { value: data.total, label: "Total", color: "#8899aa" },
                      { value: data.alive, label: "Alive", color: "#2DD4A0" },
                      { value: dead, label: "Dead", color: dead > 0 ? "#FF6B6B" : "#334455" },
                      { value: data.kills, label: "Kills", color: data.kills > 0 ? "#FFB84A" : "#334455" },
                    ].map(stat => (
                      <div key={stat.label} style={{
                        textAlign: "center", padding: "6px 4px",
                        background: "rgba(0,0,0,0.15)", borderRadius: 5,
                      }}>
                        <div style={{
                          fontSize: 14, fontWeight: 700, color: stat.color,
                          fontFamily: "'JetBrains Mono', monospace", lineHeight: 1,
                        }}>
                          {stat.value.toLocaleString()}
                        </div>
                        <div style={{
                          fontSize: 8, color: "#556677", fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: "0.08em", marginTop: 3, fontWeight: 600,
                        }}>
                          {stat.label.toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Combat Summary */}
        {(() => {
          const totalKills = Object.values(mission.sides).reduce((s, d) => s + (d.kills || 0), 0);
          const playerKills = Object.values(mission.sides).reduce((s, d) => s + (d.players > 0 ? d.kills : 0), 0);
          return (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
            }}>
              <div style={{
                padding: "12px 10px", borderRadius: 8, textAlign: "center",
                background: "rgba(255,74,74,0.04)", border: "1px solid rgba(255,74,74,0.08)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 4 }}>
                  <span style={{ color: "#FF4A4A88" }}><Icons.Crosshair /></span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>
                    {mission.kills.toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>
                  TOTAL KILLS
                </div>
              </div>
              <div style={{
                padding: "12px 10px", borderRadius: 8, textAlign: "center",
                background: "rgba(74,158,255,0.04)", border: "1px solid rgba(74,158,255,0.08)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 4 }}>
                  <span style={{ color: "#4A9EFF88" }}><Icons.Users /></span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#6BB3FF", fontFamily: "'JetBrains Mono', monospace" }}>
                    {playerKills.toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>
                  PLAYER KILLS
                </div>
              </div>
              <div style={{
                padding: "12px 10px", borderRadius: 8, textAlign: "center",
                background: "rgba(255,184,74,0.04)", border: "1px solid rgba(255,184,74,0.08)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 4 }}>
                  <span style={{ color: "#FFB84A88" }}><Icons.Zap /></span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#FFB84A", fontFamily: "'JetBrains Mono', monospace" }}>
                    {mission.durationSec > 0 ? (mission.kills / (mission.durationSec / 60)).toFixed(1) : "0"}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em" }}>
                  KILLS/MIN
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Admin Actions */}
      {isAdmin && mission.playerList && (
        <PlayerManagement players={mission.playerList} sideColors={SIDE_COLORS} />
      )}

      {/* Admin Edit/Delete */}
      {isAdmin && (
        <div style={{
          padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 2 }}>
            ADMIN ACTIONS
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onEdit(mission)} style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              background: "rgba(74,158,255,0.06)", border: "1px solid rgba(74,158,255,0.15)",
              color: "#4A9EFF", fontSize: 11, fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
            }}>
              <Icons.Edit /> Edit
            </button>
            <button onClick={() => onDelete(mission)} style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              background: "rgba(255,74,74,0.06)", border: "1px solid rgba(255,74,74,0.15)",
              color: "#FF6B6B", fontSize: 11, fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
            }}>
              <Icons.Trash /> Delete
            </button>
          </div>
          {mission.status === "failed" && (
            <button onClick={() => onRetry(mission.id)} style={{
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(255,184,74,0.06)", border: "1px solid rgba(255,184,74,0.15)",
              color: "#FFB84A", fontSize: 11, fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
            }}>
              <Icons.RefreshCw /> Retry Conversion
            </button>
          )}
          {mission.status === "converting" && (
            <div style={{
              padding: "6px 10px", borderRadius: 6,
              background: "rgba(255,184,74,0.04)", border: "1px solid rgba(255,184,74,0.08)",
              fontSize: 10, color: "#FFB84A88", fontFamily: "'JetBrains Mono', monospace",
              textAlign: "center",
            }}>
              Conversion in progress — cannot modify
            </div>
          )}
        </div>
      )}

      {/* Launch Button */}
      <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => isReady && onLaunch(mission)}
          disabled={!isReady}
          style={{
            width: "100%", padding: "14px 20px",
            borderRadius: 10, border: "none", cursor: isReady ? "pointer" : "not-allowed",
            background: isReady
              ? "linear-gradient(135deg, #4A9EFF, #3585dd)"
              : "rgba(255,255,255,0.04)",
            color: isReady ? "#fff" : "#445566",
            fontSize: 13, fontWeight: 700,
            fontFamily: "'Outfit', sans-serif",
            letterSpacing: "0.05em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: isReady ? "0 4px 20px rgba(74,158,255,0.25)" : "none",
            transition: "all 0.2s",
          }}
        >
          {isReady ? (
            <>
              <Icons.Play /> Open Replay
              <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 11 }}><Icons.ArrowRight /></span>
            </>
          ) : (
            <>{STATUS[mission.status]?.label || "Unavailable"}</>
          )}
        </button>
      </div>
    </div>
  );
}


// ─── Sort Header ─────────────────────────────────────────────────────────────
function SortHeader({ label, sortKey, currentSort, currentDir, onSort, style }) {
  const active = currentSort === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 4, padding: 0,
        color: active ? "#c8d4e0" : "#556677",
        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600, letterSpacing: "0.08em",
        transition: "color 0.15s",
        ...style,
      }}
    >
      {label}
      {active && (currentDir === "asc" ? <Icons.SortDesc /> : <Icons.SortAsc />)}
    </button>
  );
}


// ─── OCAP Logo SVG ───────────────────────────────────────────────────────────
function OcapLogo({ size = 36 }) {
  const s = size;
  const r = s * 0.09;
  const nodes = [
    // Center cluster (blue)
    { x: 0.5, y: 0.45, c: "#4A9EFF", r: 1.4 },
    { x: 0.42, y: 0.35, c: "#4A9EFF", r: 1 },
    { x: 0.58, y: 0.35, c: "#4A9EFF", r: 1 },
    { x: 0.38, y: 0.5,  c: "#4A9EFF", r: 0.8 },
    { x: 0.62, y: 0.5,  c: "#4A9EFF", r: 0.8 },
    // Left branch (red)
    { x: 0.22, y: 0.28, c: "#FF4A4A", r: 1.1 },
    { x: 0.12, y: 0.2,  c: "#FF4A4A", r: 0.7 },
    { x: 0.15, y: 0.4,  c: "#FF4A4A", r: 0.7 },
    // Right branch (red)
    { x: 0.78, y: 0.28, c: "#FF4A4A", r: 1.1 },
    { x: 0.88, y: 0.2,  c: "#FF4A4A", r: 0.7 },
    { x: 0.85, y: 0.4,  c: "#FF4A4A", r: 0.7 },
    // Bottom nodes
    { x: 0.35, y: 0.65, c: "#4A9EFF", r: 0.7 },
    { x: 0.65, y: 0.65, c: "#4A9EFF", r: 0.7 },
    { x: 0.5,  y: 0.72, c: "#FF4A4A", r: 0.9 },
  ];
  const edges = [
    [0,1],[0,2],[0,3],[0,4],[1,2],[1,5],[2,8],[3,4],[3,11],[4,12],
    [5,6],[5,7],[5,1],[8,9],[8,10],[8,2],[11,13],[12,13],[0,13],
  ];
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a].x * s} y1={nodes[a].y * s}
          x2={nodes[b].x * s} y2={nodes[b].y * s}
          stroke="rgba(255,255,255,0.15)" strokeWidth={s * 0.015}
        />
      ))}
      {nodes.map((n, i) => (
        <circle key={i}
          cx={n.x * s} cy={n.y * s}
          r={r * n.r} fill={n.c}
        />
      ))}
      {/* OCAP text */}
      <text x={s * 0.5} y={s * 0.92} textAnchor="middle"
        fill="#e0e6ed" fontSize={s * 0.16} fontWeight="800"
        fontFamily="'Outfit', sans-serif" letterSpacing={s * 0.015}
      >OCAP</text>
    </svg>
  );
}


// ─── Player List ─────────────────────────────────────────────────────────────
function PlayerManagement({ players, sideColors }) {
  const [expanded, setExpanded] = useState(true);

  const totalMarkers = players.reduce((s, p) => s + p.markers, 0);
  const sorted = [...players].sort((a, b) => b.kills - a.kills || b.markers - a.markers);

  return (
    <div style={{ padding: "0 16px 12px" }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", background: "none", border: "none", cursor: "pointer",
        padding: "0 0 8px", margin: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", fontWeight: 600 }}>
            PLAYERS
          </span>
          <span style={{
            fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            color: "#8899aa", background: "rgba(255,255,255,0.04)",
            padding: "1px 6px", borderRadius: 3,
          }}>{players.length}</span>
        </div>
        <span style={{
          color: "#445566", display: "flex",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          transition: "transform 0.2s",
        }}>
          <Icons.ChevronDown />
        </span>
      </button>

      {expanded && (
        <div style={{ animation: "fadeIn 0.15s ease-out" }}>
          {/* Player list */}
          <div style={{
            maxHeight: 260, overflowY: "auto",
            display: "flex", flexDirection: "column",
          }}>
            {sorted.map((player, i) => {
              const color = sideColors[player.side] || "#667788";
              return (
                <div key={player.uid} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 8px",
                  background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                  borderRadius: 4,
                }}>
                  {/* Side dot */}
                  <div style={{ width: 6, height: 6, borderRadius: 2, background: color, flexShrink: 0 }}/>

                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 11, color: "#c8d4e0",
                      fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      display: "block",
                    }}>
                      {player.name}
                    </span>
                    {/* Stats row */}
                    <div style={{ display: "flex", gap: 6, marginTop: 1 }}>
                      <span style={{ fontSize: 9, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
                        <span style={{ color: player.kills > 0 ? "#FF6B6B" : "#334455" }}>{player.kills}</span>
                        <span style={{ opacity: 0.4 }}>/</span>
                        <span style={{ color: player.deaths > 0 ? "#FFB84A" : "#334455" }}>{player.deaths}</span>
                        <span style={{ opacity: 0.3, marginLeft: 2 }}>K/D</span>
                      </span>
                    </div>
                  </div>

                  {/* Marker count */}
                  {player.markers > 0 && (
                    <span style={{
                      fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                      color: "#667788",
                      background: "rgba(255,255,255,0.03)",
                      padding: "2px 5px", borderRadius: 3, flexShrink: 0,
                      display: "flex", alignItems: "center", gap: 3,
                    }}>
                      <Icons.MapPin /> {player.markers}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Edit Modal ──────────────────────────────────────────────────────────────
function EditModal({ mission, onSave, onCancel }) {
  const [name, setName] = useState(mission.name);
  const [tag, setTag] = useState(mission.tag);
  const [date, setDate] = useState(mission.date);

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease-out",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, background: "#131c28",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        animation: "fadeScale 0.2s ease-out",
      }}>
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#4A9EFF" }}><Icons.Edit /></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif" }}>Edit Recording</span>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "#556677", cursor: "pointer", display: "flex" }}>
            <Icons.X />
          </button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Read-only metadata */}
          <div style={{
            display: "flex", gap: 8, flexWrap: "wrap",
            padding: "8px 10px", borderRadius: 6,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
          }}>
            {[
              { label: "ID", value: `#${mission.id}` },
              { label: "Map", value: (MAPS[mission.map]?.name || mission.map) },
              { label: "Format", value: mission.storageFormat || "json" },
              { label: "Status", value: STATUS[mission.status]?.label || mission.status },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>{item.label}:</span>
                <span style={{ fontSize: 10, color: "#8899aa", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
              MISSION NAME
            </label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e0e6ed", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none",
            }}/>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
                TAG
              </label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {["TvT", "COOP", "Zeus", "Training", ""].map(t => (
                  <button key={t} onClick={() => setTag(t)} style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    background: tag === t ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.03)",
                    color: tag === t ? "#4A9EFF" : "#667788",
                    border: `1px solid ${tag === t ? "rgba(74,158,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                    transition: "all 0.15s",
                  }}>
                    {t || "None"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
              DATE
            </label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
              padding: "10px 12px", borderRadius: 8,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#e0e6ed", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none",
              colorScheme: "dark",
            }}/>
          </div>
        </div>
        <div style={{
          padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onCancel} style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent", color: "#8899aa", fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={() => onSave({ ...mission, name, tag, date })} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "linear-gradient(135deg, #4A9EFF, #3585dd)",
            color: "#fff", fontSize: 12, fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
            boxShadow: "0 2px 8px rgba(74,158,255,0.25)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.Check /> Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirmation ─────────────────────────────────────────────────────
function DeleteConfirm({ mission, onConfirm, onCancel }) {
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease-out",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 380, background: "#131c28",
        border: "1px solid rgba(255,74,74,0.2)", borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        animation: "fadeScale 0.2s ease-out",
      }}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, margin: "0 auto 16px",
            background: "rgba(255,74,74,0.1)", border: "1px solid rgba(255,74,74,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#FF6B6B",
          }}>
            <Icons.AlertTriangle />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif", marginBottom: 8 }}>
            Delete Recording
          </div>
          <div style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.5, marginBottom: 4 }}>
            Are you sure you want to delete
          </div>
          <div style={{ fontSize: 13, color: "#e0e6ed", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, marginBottom: 4 }}>
            {mission.name}
          </div>
          <div style={{ fontSize: 11, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
            {formatDate(mission.date)} · {mission.duration}
          </div>
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 6,
            background: "rgba(255,74,74,0.06)", border: "1px solid rgba(255,74,74,0.1)",
            fontSize: 11, color: "#FF6B6B88", lineHeight: 1.4,
          }}>
            This will remove the database record and all associated files (.json.gz + protobuf chunks). This action cannot be undone.
          </div>
        </div>
        <div style={{
          padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onCancel} style={{
            padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent", color: "#8899aa", fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={() => onConfirm(mission.id)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "linear-gradient(135deg, #FF4A4A, #cc3333)",
            color: "#fff", fontSize: 12, fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
            boxShadow: "0 2px 8px rgba(255,74,74,0.25)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.Trash /> Delete Recording</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload Zone ─────────────────────────────────────────────────────────────
function UploadDialog({ onUpload, onCancel }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [map, setMap] = useState("");
  const [tag, setTag] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    // Auto-fill name from filename if empty
    if (!name) {
      const base = f.name.replace(/\.json\.gz$/, "").replace(/\.json$/, "");
      setName(base);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const handleSubmit = () => {
    if (!file || !name) return;
    setUploading(true);
    // Simulate upload — in production this POSTs to /api/v1/operations/add
    setTimeout(() => {
      onUpload({ name, map, tag, date, fileName: file.name });
      setUploading(false);
    }, 1500);
  };

  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
    color: "#e0e6ed", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none",
  };
  const labelStyle = {
    display: "block", fontSize: 10, color: "#556677",
    fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em",
    fontWeight: 600, marginBottom: 6,
  };

  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.15s ease-out",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, background: "#131c28",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        animation: "fadeScale 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#2DD4A0" }}><Icons.Upload /></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif" }}>Upload Recording</span>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: "#556677", cursor: "pointer", display: "flex" }}>
            <Icons.X />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* File drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !file && document.getElementById("uploadFileInput")?.click()}
            style={{
              padding: file ? "10px 14px" : "20px 14px",
              borderRadius: 10,
              border: `2px dashed ${file ? "rgba(45,212,160,0.3)" : dragOver ? "#4A9EFF" : "rgba(255,255,255,0.1)"}`,
              background: file ? "rgba(45,212,160,0.04)" : dragOver ? "rgba(74,158,255,0.06)" : "rgba(255,255,255,0.02)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              cursor: file ? "default" : "pointer",
              transition: "all 0.2s",
            }}
          >
            <input id="uploadFileInput" type="file" accept=".json.gz,.json" style={{ display: "none" }}
              onChange={e => handleFile(e.target.files?.[0])}
            />
            {file ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#2DD4A0",
                }}>
                  <Icons.Check />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: "#e0e6ed", fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{file.name}</div>
                  <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
                    {(file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); }} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#556677", display: "flex",
                }}>
                  <Icons.X />
                </button>
              </div>
            ) : (
              <>
                <div style={{ color: "#4A9EFF", opacity: 0.6 }}><Icons.FilePlus /></div>
                <div style={{ fontSize: 12, color: "#8899aa", fontFamily: "'JetBrains Mono', monospace", textAlign: "center" }}>
                  Drop <span style={{ color: "#c8d4e0" }}>.json.gz</span> recording here or <span style={{ color: "#4A9EFF", textDecoration: "underline" }}>browse</span>
                </div>
              </>
            )}
          </div>

          {/* Mission Name */}
          <div>
            <label style={labelStyle}>MISSION NAME <span style={{ color: "#FF6B6B" }}>*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. MP_COOP_m05" style={inputStyle}
            />
          </div>

          {/* Map Name */}
          <div>
            <label style={labelStyle}>MAP / WORLD NAME <span style={{ color: "#FF6B6B" }}>*</span></label>
            <input type="text" value={map} onChange={e => setMap(e.target.value)}
              placeholder="e.g. altis, tanoa, livonia" list="mapSuggestions" style={inputStyle}
            />
            <datalist id="mapSuggestions">
              {Object.entries(MAPS).map(([key, m]) => (
                <option key={key} value={key}>{m.name}</option>
              ))}
            </datalist>
          </div>

          {/* Tag + Date row */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>TAG</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {["TvT", "COOP", "Zeus", "Training", ""].map(t => (
                  <button key={t} onClick={() => setTag(t)} style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    background: tag === t ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.03)",
                    color: tag === t ? "#4A9EFF" : "#667788",
                    border: `1px solid ${tag === t ? "rgba(74,158,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                    transition: "all 0.15s",
                  }}>
                    {t || "None"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={labelStyle}>DATE</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>
            {!file ? "Select a file to upload" : !name ? "Enter a mission name" : "Ready to upload"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel} style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent", color: "#8899aa", fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
            }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!file || !name || uploading}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: (!file || !name || uploading) ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, #2DD4A0, #1a9a74)",
                color: (!file || !name || uploading) ? "#445566" : "#fff",
                fontSize: 12, fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: (!file || !name || uploading) ? "not-allowed" : "pointer",
                boxShadow: (!file || !name || uploading) ? "none" : "0 2px 8px rgba(45,212,160,0.25)",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              {uploading ? (
                <><span style={{ display: "flex", animation: "spin 1s linear infinite" }}><Icons.RefreshCw /></span> Uploading...</>
              ) : (
                <><Icons.Upload /> Upload Recording</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────────────────────
export default function MissionSelector() {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState(null);
  const [mapFilter, setMapFilter] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [launched, setLaunched] = useState(null);
  const [lang, setLang] = useState("en");
  const [langOpen, setLangOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [editingMission, setEditingMission] = useState(null);
  const [deletingMission, setDeletingMission] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [missions, setMissions] = useState(MISSIONS);
  const searchRef = useRef(null);

  // Focus search on '/'
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const filtered = useMemo(() => {
    let result = [...missions];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(s) ||
        (MAPS[m.map]?.name || m.map).toLowerCase().includes(s)
      );
    }
    if (tagFilter) result = result.filter(m => m.tag === tagFilter);
    if (mapFilter) result = result.filter(m => m.map === mapFilter);

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "date": cmp = new Date(a.date) - new Date(b.date); break;
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "duration": cmp = a.durationSec - b.durationSec; break;
        case "players": cmp = a.players - b.players; break;
        case "kills": cmp = a.kills - b.kills; break;
        default: cmp = 0;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [search, tagFilter, mapFilter, sortBy, sortDir, missions]);

  const selectedMission = missions.find(m => m.id === selectedId);

  const uniqueMaps = [...new Set(missions.map(m => m.map))];

  const handleLaunch = (mission) => { setLaunched(mission); };

  // Admin handlers
  const handleSteamLogin = () => {
    // In production: redirect to Steam OpenID. Here we simulate.
    setIsAdmin(true);
    setAdminUser({ name: "Florian", avatarUrl: null, steamId: "76561198012345678" });
  };
  const handleLogout = () => { setIsAdmin(false); setAdminUser(null); setShowUpload(false); };
  const handleEditSave = (updated) => {
    setMissions(prev => prev.map(m => m.id === updated.id ? { ...m, name: updated.name, tag: updated.tag, date: updated.date } : m));
    setEditingMission(null);
  };
  const handleDelete = (id) => {
    setMissions(prev => prev.filter(m => m.id !== id));
    setDeletingMission(null);
    setSelectedId(null);
  };
  const handleRetryConversion = (id) => {
    setMissions(prev => prev.map(m => m.id === id ? { ...m, status: "pending" } : m));
  };
  const handleUpload = ({ name, map, tag, date }) => {
    const newId = Math.max(...missions.map(m => m.id)) + 1;
    setMissions(prev => [{
      id: newId, name, map: map || "unknown", date, duration: "—", durationSec: 0,
      tag, status: "pending", storageFormat: "json", players: 0, kills: 0, sides: {},
    }, ...prev]);
    setShowUpload(false);
  };

  // ── Transition to replay ──────────────────────────────
  if (launched) {
    return (
      <div style={{
        width: "100vw", height: "100vh",
        background: "#0a0f14",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.3s ease-out",
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes loadPulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
          @keyframes loadBar { from { width: 0%; } to { width: 100%; } }
        `}</style>
        <div style={{ textAlign: "center", animation: "fadeIn 0.4s ease-out" }}>
          {/* OCAP Logo */}
          <div style={{ margin: "0 auto 20px", width: 56, height: 56 }}>
            <svg width="56" height="56" viewBox="0 0 42 42" fill="none">
              <circle cx="21" cy="21" r="19" stroke="url(#loadGrad)" strokeWidth="1.5" opacity="0.3"/>
              <circle cx="21" cy="21" r="4" fill="#4A9EFF"/>
              <circle cx="10" cy="12" r="2.5" fill="#FF4A4A"/>
              <circle cx="32" cy="12" r="2.5" fill="#FF4A4A"/>
              <circle cx="10" cy="30" r="2.5" fill="#4A9EFF"/>
              <circle cx="32" cy="30" r="2.5" fill="#4A9EFF"/>
              <circle cx="21" cy="6" r="2" fill="#2DD4A0"/>
              <circle cx="21" cy="36" r="2" fill="#2DD4A0"/>
              <line x1="21" y1="21" x2="10" y2="12" stroke="#FF4A4A" strokeWidth="1" opacity="0.4"/>
              <line x1="21" y1="21" x2="32" y2="12" stroke="#FF4A4A" strokeWidth="1" opacity="0.4"/>
              <line x1="21" y1="21" x2="10" y2="30" stroke="#4A9EFF" strokeWidth="1" opacity="0.4"/>
              <line x1="21" y1="21" x2="32" y2="30" stroke="#4A9EFF" strokeWidth="1" opacity="0.4"/>
              <line x1="21" y1="21" x2="21" y2="6" stroke="#2DD4A0" strokeWidth="1" opacity="0.3"/>
              <line x1="21" y1="21" x2="21" y2="36" stroke="#2DD4A0" strokeWidth="1" opacity="0.3"/>
              <circle cx="21" cy="21" r="6" fill="#4A9EFF" opacity="0.1"/>
              <defs>
                <linearGradient id="loadGrad" x1="0" y1="0" x2="42" y2="42">
                  <stop offset="0%" stopColor="#4A9EFF"/>
                  <stop offset="100%" stopColor="#2DD4A0"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif", marginBottom: 6 }}>
            Loading {launched.name}
          </div>
          <div style={{ fontSize: 11, color: "#556677", fontFamily: "'JetBrains Mono', monospace", marginBottom: 24 }}>
            {MAPS[launched.map]?.name} · {launched.duration}
          </div>
          <div style={{ width: 200, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, margin: "0 auto", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: "linear-gradient(90deg, #4A9EFF, #2DD4A0)",
              animation: "loadBar 2s ease-in-out forwards",
            }}/>
          </div>
          <div style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace", marginTop: 12, animation: "loadPulse 1.5s ease-in-out infinite" }}>
            Initializing replay engine...
          </div>
        </div>
      </div>
    );
  }

  // ── Mission Browser ────────────────────────────────────
  return (
    <div style={{
      width: "100vw", height: "100vh", overflow: "hidden",
      background: "#0a0f14", color: "#c8d4e0",
      display: "flex", flexDirection: "column",
      fontFamily: "'Segoe UI', -apple-system, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        *::-webkit-scrollbar { width: 5px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        button:hover { filter: brightness(1.1); }
        input::placeholder { color: #445566; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeScale { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes stagger { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes loadBar { from { width: 0%; } to { width: 100%; } }
      `}</style>

      {/* ── Header ─────────────────────────────────────── */}
      <header style={{
        padding: "20px 32px 0",
        flexShrink: 0,
        animation: "fadeIn 0.4s ease-out",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* OCAP Logo */}
            <div style={{ position: "relative", width: 42, height: 42, flexShrink: 0 }}>
              <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                {/* Outer ring */}
                <circle cx="21" cy="21" r="19" stroke="url(#logoGrad)" strokeWidth="1.5" opacity="0.3"/>
                {/* Center node */}
                <circle cx="21" cy="21" r="4" fill="#4A9EFF"/>
                {/* Connection nodes */}
                <circle cx="10" cy="12" r="2.5" fill="#FF4A4A"/>
                <circle cx="32" cy="12" r="2.5" fill="#FF4A4A"/>
                <circle cx="10" cy="30" r="2.5" fill="#4A9EFF"/>
                <circle cx="32" cy="30" r="2.5" fill="#4A9EFF"/>
                <circle cx="21" cy="6" r="2" fill="#2DD4A0"/>
                <circle cx="21" cy="36" r="2" fill="#2DD4A0"/>
                {/* Connection lines */}
                <line x1="21" y1="21" x2="10" y2="12" stroke="#FF4A4A" strokeWidth="1" opacity="0.4"/>
                <line x1="21" y1="21" x2="32" y2="12" stroke="#FF4A4A" strokeWidth="1" opacity="0.4"/>
                <line x1="21" y1="21" x2="10" y2="30" stroke="#4A9EFF" strokeWidth="1" opacity="0.4"/>
                <line x1="21" y1="21" x2="32" y2="30" stroke="#4A9EFF" strokeWidth="1" opacity="0.4"/>
                <line x1="21" y1="21" x2="21" y2="6" stroke="#2DD4A0" strokeWidth="1" opacity="0.3"/>
                <line x1="21" y1="21" x2="21" y2="36" stroke="#2DD4A0" strokeWidth="1" opacity="0.3"/>
                {/* Glow on center */}
                <circle cx="21" cy="21" r="6" fill="#4A9EFF" opacity="0.1"/>
                <defs>
                  <linearGradient id="logoGrad" x1="0" y1="0" x2="42" y2="42">
                    <stop offset="0%" stopColor="#4A9EFF"/>
                    <stop offset="100%" stopColor="#2DD4A0"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.02em" }}>
                  OCAP
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: "#4A9EFF",
                  fontFamily: "'JetBrains Mono', monospace",
                  background: "rgba(74,158,255,0.1)",
                  border: "1px solid rgba(74,158,255,0.2)",
                  borderRadius: 4, padding: "1px 6px",
                  letterSpacing: "0.04em",
                }}>v2</span>
              </div>
              <div style={{ fontSize: 11, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
                Operation Capture and Playback · {missions.length} recordings
              </div>
            </div>
          </div>

          {/* Right side: stats + language */}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {/* Summary stats */}
            <div style={{ display: "flex", gap: 24 }}>
              <StatPill icon={<Icons.Globe />} value={uniqueMaps.length} label="MAPS" />
              <StatPill icon={<Icons.Users />} value={Math.max(...missions.map(m => m.players))} label="MAX PLAYERS" />
              <StatPill icon={<Icons.Crosshair />} value={missions.reduce((s, m) => s + m.kills, 0)} label="TOTAL KILLS" />
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.06)" }}/>

            {/* Language Selector */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setLangOpen(!langOpen)} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer", color: "#8899aa",
                fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 15 }}>{LANGUAGES.find(l => l.code === lang)?.flag}</span>
                <span style={{ fontSize: 11 }}>{LANGUAGES.find(l => l.code === lang)?.label}</span>
                <span style={{ opacity: 0.5, display: "flex", transform: langOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  <Icons.ChevronDown />
                </span>
              </button>
              {langOpen && (
                <>
                  <div onClick={() => setLangOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>
                  <div style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 6,
                    background: "rgba(13,21,32,0.97)", backdropFilter: "blur(16px)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
                    padding: 4, minWidth: 170, zIndex: 100,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    animation: "fadeIn 0.15s ease-out",
                  }}>
                    <div style={{ padding: "6px 12px", fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", fontWeight: 600 }}>
                      LANGUAGE
                    </div>
                    {LANGUAGES.map(l => (
                      <button key={l.code} onClick={() => { setLang(l.code); setLangOpen(false); }} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "8px 12px", border: "none", borderRadius: 6,
                        background: lang === l.code ? "rgba(74,158,255,0.1)" : "transparent",
                        cursor: "pointer", transition: "all 0.1s",
                      }}>
                        <span style={{ fontSize: 16 }}>{l.flag}</span>
                        <span style={{
                          fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                          color: lang === l.code ? "#4A9EFF" : "#8899aa",
                          fontWeight: lang === l.code ? 600 : 400,
                        }}>{l.label}</span>
                        {lang === l.code && (
                          <span style={{ marginLeft: "auto", color: "#4A9EFF", fontSize: 11 }}>✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.06)" }}/>

            {/* Steam Login / Admin Badge */}
            {isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 12px 5px 6px", borderRadius: 8,
                  background: "rgba(45,212,160,0.08)",
                  border: "1px solid rgba(45,212,160,0.15)",
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: "linear-gradient(135deg, #2DD4A0, #1a9a74)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#0a0f14", fontSize: 11, fontWeight: 700,
                    fontFamily: "'Outfit', sans-serif",
                  }}>
                    {adminUser?.name?.[0] || "A"}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#e0e6ed", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, lineHeight: 1 }}>
                      {adminUser?.name || "Admin"}
                    </div>
                    <div style={{ fontSize: 8, color: "#2DD4A0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                      <Icons.Shield /> ADMIN
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowUpload(u => !u)} title="Upload recording" style={{
                  width: 34, height: 34, borderRadius: 8, cursor: "pointer",
                  background: showUpload ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${showUpload ? "rgba(74,158,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: showUpload ? "#4A9EFF" : "#8899aa",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icons.Upload />
                </button>
                <button onClick={handleLogout} title="Sign out" style={{
                  width: 34, height: 34, borderRadius: 8, cursor: "pointer",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#556677", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icons.LogOut />
                </button>
              </div>
            ) : (
              <button onClick={handleSteamLogin} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                background: "linear-gradient(135deg, #171a21, #1b2838)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#c7d5e0", fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                transition: "all 0.15s",
              }}>
                <Icons.Steam />
                Sign in
              </button>
            )}
          </div>
        </div>

        {/* Upload Zone (admin only) */}
        {/* Upload dialog rendered as modal below */}

        {/* ── Search & Filters ─────────────────────────── */}
        <div style={{
          display: "flex", gap: 12, alignItems: "center",
          paddingBottom: 16,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {/* Search */}
          <div style={{
            flex: 1, maxWidth: 400, position: "relative",
            display: "flex", alignItems: "center",
          }}>
            <span style={{ position: "absolute", left: 12, color: "#445566", display: "flex" }}><Icons.Search /></span>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search missions or maps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px 10px 38px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, color: "#c8d4e0", fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none", transition: "border-color 0.2s",
              }}
              onFocus={(e) => e.target.style.borderColor = "rgba(74,158,255,0.3)"}
              onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
            />
            <kbd style={{
              position: "absolute", right: 10,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4, padding: "1px 6px", fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace", color: "#445566",
            }}>/</kbd>
          </div>

          {/* Tag filters */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: "#445566", marginRight: 4 }}><Icons.Tag /></span>
            {TAGS.map(tag => (
              <TagBadge
                key={tag} tag={tag} clickable
                active={tagFilter === null || tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              />
            ))}
          </div>

          {/* Map filter */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ color: "#445566", marginRight: 4 }}><Icons.Map /></span>
            {uniqueMaps.map(mapKey => {
              const mapData = MAPS[mapKey] || { name: mapKey, color: "#667" };
              const active = mapFilter === null || mapFilter === mapKey;
              return (
                <button
                  key={mapKey}
                  onClick={() => setMapFilter(mapFilter === mapKey ? null : mapKey)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    background: active ? `${mapData.color}18` : "rgba(255,255,255,0.02)",
                    color: active ? mapData.color : "#445566",
                    border: `1px solid ${active ? mapData.color + "30" : "rgba(255,255,255,0.05)"}`,
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: 1, background: active ? mapData.color : "#445566" }}/>
                  {mapData.name}
                </button>
              );
            })}
          </div>

          {search || tagFilter || mapFilter ? (
            <button onClick={() => { setSearch(""); setTagFilter(null); setMapFilter(null); }} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "6px 10px", borderRadius: 6, border: "none",
              background: "rgba(255,74,74,0.1)", color: "#FF6B6B",
              fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
            }}>
              <Icons.X /> Clear
            </button>
          ) : null}
        </div>
      </header>

      {/* ── Main Content ──────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Table ────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Column Headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 130px 100px 90px 80px 70px 100px",
            padding: "10px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}>
            <SortHeader label="MISSION" sortKey="name" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
            <SortHeader label="DATE" sortKey="date" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
            <SortHeader label="DURATION" sortKey="duration" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
            <SortHeader label="PLAYERS" sortKey="players" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
            <SortHeader label="KILLS" sortKey="kills" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
            <span style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: "0.08em" }}>TAG</span>
            <span style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: "0.08em", textAlign: "right" }}>STATUS</span>
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                height: 200, gap: 8, opacity: 0.5,
              }}>
                <Icons.Search />
                <span style={{ fontSize: 13, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
                  No missions found
                </span>
                <span style={{ fontSize: 11, color: "#445566" }}>
                  Try adjusting your filters
                </span>
              </div>
            ) : (
              filtered.map((mission, i) => (
                <MissionRow
                  key={mission.id}
                  mission={mission}
                  selected={selectedId === mission.id}
                  onSelect={setSelectedId}
                  onLaunch={handleLaunch}
                  style={{ animation: `stagger 0.3s ease-out ${Math.min(i * 0.03, 0.3)}s both` }}
                />
              ))
            )}
          </div>

          {/* Footer with version info */}
          <div style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            {/* Left: Version info */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <a href="https://github.com/OCAP2/web" target="_blank" rel="noopener noreferrer" style={{
                  display: "flex", alignItems: "center", gap: 5,
                  color: "#556677", textDecoration: "none",
                  fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  transition: "color 0.15s",
                  cursor: "pointer",
                }}>
                  <Icons.GitHub />
                  <span>OCAP2</span>
                  <Icons.ExternalLink />
                </a>
              </div>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }}/>
              <div style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "Server", value: "2.1.0" },
                  { label: "Extension", value: "0.0.1" },
                  { label: "Addon", value: "1.3.2" },
                ].map(v => (
                  <span key={v.label} style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#445566" }}>
                    {v.label}{" "}
                    <span style={{ color: "#556677" }}>{v.value}</span>
                  </span>
                ))}
              </div>
              <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.06)" }}/>
              <span style={{ fontSize: 10, color: "#334455", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 3 }}>
                Made with <span style={{ color: "#FF4A4A" }}><Icons.Heart /></span> for the Arma community
              </span>
            </div>

            {/* Center: Result count */}
            <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>
              {filtered.length} of {missions.length} missions
            </span>

            {/* Right: Keyboard shortcuts */}
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { key: "Esc", action: "Deselect" },
                { key: "/", action: "Search" },
                { key: "Enter", action: "Open" },
              ].map(({ key, action }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <kbd style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 3, padding: "1px 5px", fontSize: 9,
                    fontFamily: "'JetBrains Mono', monospace", color: "#556677",
                  }}>{key}</kbd>
                  <span style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Detail Sidebar ───────────────────────────── */}
        {selectedMission && (
          <DetailSidebar
            mission={selectedMission}
            onLaunch={handleLaunch}
            onClose={() => setSelectedId(null)}
            isAdmin={isAdmin}
            onEdit={setEditingMission}
            onDelete={setDeletingMission}
            onRetry={handleRetryConversion}
          />
        )}
      </div>

      {/* ── Admin Modals ──────────────────────────────── */}
      {editingMission && (
        <EditModal
          mission={editingMission}
          onSave={handleEditSave}
          onCancel={() => setEditingMission(null)}
        />
      )}
      {deletingMission && (
        <DeleteConfirm
          mission={deletingMission}
          onConfirm={handleDelete}
          onCancel={() => setDeletingMission(null)}
        />
      )}
      {showUpload && (
        <UploadDialog
          onUpload={handleUpload}
          onCancel={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
