import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Mock Data ───────────────────────────────────────────────────────────────
const SIDES = {
  BLUFOR: { color: "#4A9EFF", bg: "rgba(74,158,255,0.12)", label: "BLUFOR", icon: "◆" },
  OPFOR:  { color: "#FF4A4A", bg: "rgba(255,74,74,0.12)",  label: "OPFOR",  icon: "◆" },
  IND:    { color: "#2DD4A0", bg: "rgba(45,212,160,0.12)",  label: "IND",    icon: "◆" },
  CIV:    { color: "#A78BFA", bg: "rgba(167,139,250,0.12)", label: "CIV",    icon: "◆" },
};

const GROUPS = {
  BLUFOR: [
    { name: "Alpha 1-1", units: [
      { id: 1, name: "Cameron Thomson", role: "SL", isPlayer: true, kills: 2, deaths: 0, alive: true },
      { id: 2, name: "Jake O'Connor", role: "AR", isPlayer: true, kills: 1, deaths: 1, alive: false },
    ]},
    { name: "Alpha 1-2", units: [
      { id: 3, name: "Matthew Young", role: "MED", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 4, name: "Adam Byrne", role: "AT", isPlayer: false, kills: 0, deaths: 1, alive: false },
      { id: 5, name: "Spencer Patel", role: "DM", isPlayer: false, kills: 1, deaths: 0, alive: true },
    ]},
    { name: "Alpha 1-3", units: [
      { id: 6, name: "Owen King", role: "SL", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 7, name: "Callum Roberts", role: "AR", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 8, name: "Callum Turner", role: "MED", isPlayer: false, kills: 0, deaths: 1, alive: false },
      { id: 9, name: "Dwan Scott", role: "AT", isPlayer: false, kills: 0, deaths: 0, alive: true },
    ]},
    { name: "Alpha 2-1", units: [
      { id: 10, name: "Jack Reed", role: "FTL", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 11, name: "Ethan Wilson", role: "AR", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 12, name: "Gillian Blackburn", role: "MED", isPlayer: false, kills: 0, deaths: 0, alive: true },
    ]},
    { name: "Alpha 2-2", units: [
      { id: 13, name: "James Campbell", role: "SL", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 14, name: "Geoff Martin", role: "AR", isPlayer: false, kills: 2, deaths: 0, alive: true },
      { id: 15, name: "Oscar King", role: "AT", isPlayer: false, kills: 0, deaths: 0, alive: true },
    ]},
  ],
  OPFOR: [
    { name: "Bravo 1-1", units: [
      { id: 20, name: "Abdullah Adel", role: "SL", isPlayer: false, kills: 0, deaths: 1, alive: false },
      { id: 21, name: "Achilleas Isofidou", role: "AR", isPlayer: false, kills: 0, deaths: 1, alive: false },
    ]},
    { name: "Bravo 1-2", units: [
      { id: 22, name: "Rashid Karim", role: "MG", isPlayer: false, kills: 1, deaths: 0, alive: true },
    ]},
  ],
  IND: [
    { name: "Charlie 1-1", units: [
      { id: 30, name: "Info", role: "OBS", isPlayer: false, kills: 0, deaths: 1, alive: false },
      { id: 31, name: "Thomas Clarke", role: "MED", isPlayer: false, kills: 0, deaths: 0, alive: true },
    ]},
  ],
  CIV: [
    { name: "Civilians", units: [
      { id: 40, name: "Local Elder", role: "CIV", isPlayer: false, kills: 0, deaths: 0, alive: true },
      { id: 41, name: "Market Vendor", role: "CIV", isPlayer: false, kills: 0, deaths: 1, alive: false },
      { id: 42, name: "Farmer", role: "CIV", isPlayer: false, kills: 0, deaths: 0, alive: true },
    ]},
  ],
};

const EVENTS = [
  // Initial connects
  { id: 7, frame: 10, time: "0:00:10", type: "connected", message: "Cameron Thomson connected" },
  { id: 8, frame: 12, time: "0:00:12", type: "connected", message: "Jake O'Connor connected" },
  { id: 70, frame: 14, time: "0:00:14", type: "connected", message: "Matthew Young connected" },
  { id: 71, frame: 15, time: "0:00:15", type: "connected", message: "Owen King connected" },
  { id: 72, frame: 16, time: "0:00:16", type: "connected", message: "Jack Reed connected" },
  // Early kill
  { id: 5, frame: 1, time: "0:00:01", type: "kill", victim: "Info", victimSide: "IND", attacker: "Info", attackerSide: "IND", weapon: "Katiba 6.5 mm", magazine: "6.5 mm 30Rnd Caseless Mag", distance: 0 },
  // First contact ~frame 50–90
  { id: 4, frame: 54, time: "0:00:54", type: "kill", victim: "Cameron Thomson", victimSide: "BLUFOR", attacker: "Cameron Thomson", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", magazine: "6.5mm 30Rnd Mag", distance: 0 },
  { id: 40, frame: 62, time: "0:01:02", type: "hit", victim: "Adam Byrne", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 280 },
  { id: 41, frame: 68, time: "0:01:08", type: "hit", victim: "Rashid Karim", victimSide: "OPFOR", attacker: "Spencer Patel", attackerSide: "BLUFOR", weapon: "MXM 6.5 mm", distance: 310 },
  { id: 2, frame: 81, time: "0:01:21", type: "kill", victim: "Abdullah Adel", victimSide: "OPFOR", attacker: "Abdullah Adel", attackerSide: "OPFOR", weapon: "AKM 7.62 mm", magazine: "7.62mm 30Rnd Mag", distance: 0 },
  { id: 3, frame: 81, time: "0:01:21", type: "kill", victim: "Achilleas Isofidou", victimSide: "OPFOR", attacker: "Achilleas Isofidou", attackerSide: "OPFOR", weapon: "AKM 7.62 mm", magazine: "7.62mm 30Rnd Mag", distance: 0 },
  { id: 42, frame: 85, time: "0:01:25", type: "hit", victim: "Owen King", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 245 },
  // Lull, then second engagement ~150-220
  { id: 43, frame: 155, time: "0:02:35", type: "hit", victim: "Callum Turner", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 180 },
  { id: 44, frame: 162, time: "0:02:42", type: "hit", victim: "Dwan Scott", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 195 },
  { id: 45, frame: 178, time: "0:02:58", type: "hit", victim: "Rashid Karim", victimSide: "OPFOR", attacker: "Geoff Martin", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", distance: 142 },
  { id: 46, frame: 185, time: "0:03:05", type: "kill", victim: "Market Vendor", victimSide: "CIV", attacker: "Geoff Martin", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", magazine: "6.5mm 30Rnd Mag", distance: 45 },
  { id: 6, frame: 200, time: "0:03:20", type: "hit", victim: "Owen King", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 340 },
  { id: 47, frame: 205, time: "0:03:25", type: "hit", victim: "Ethan Wilson", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 360 },
  { id: 48, frame: 212, time: "0:03:32", type: "kill", victim: "Callum Turner", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", magazine: "7.62mm 100Rnd Belt", distance: 175 },
  // Third push ~280-350
  { id: 49, frame: 285, time: "0:04:45", type: "hit", victim: "James Campbell", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 120 },
  { id: 50, frame: 290, time: "0:04:50", type: "hit", victim: "Rashid Karim", victimSide: "OPFOR", attacker: "Cameron Thomson", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", distance: 88 },
  { id: 51, frame: 298, time: "0:04:58", type: "hit", victim: "Oscar King", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", distance: 95 },
  { id: 52, frame: 310, time: "0:05:10", type: "kill", victim: "Adam Byrne", victimSide: "BLUFOR", attacker: "Rashid Karim", attackerSide: "OPFOR", weapon: "PKM 7.62 mm", magazine: "7.62mm 100Rnd Belt", distance: 82 },
  { id: 53, frame: 325, time: "0:05:25", type: "hit", victim: "Rashid Karim", victimSide: "OPFOR", attacker: "Geoff Martin", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", distance: 65 },
  { id: 1, frame: 340, time: "0:05:37", type: "kill", victim: "Benjamin Davis", victimSide: "BLUFOR", attacker: "Jake O'Connor", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", magazine: "6.5 mm 30Rnd Sand Mag", distance: 52 },
  { id: 54, frame: 342, time: "0:05:39", type: "kill", victim: "Rashid Karim", victimSide: "OPFOR", attacker: "Geoff Martin", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", magazine: "6.5mm 30Rnd Mag", distance: 58 },
  // Final phase ~380-420
  { id: 55, frame: 385, time: "0:06:25", type: "hit", victim: "Local Elder", victimSide: "CIV", attacker: "James Campbell", attackerSide: "BLUFOR", weapon: "MX 6.5 mm", distance: 30 },
  { id: 56, frame: 400, time: "0:06:40", type: "kill", victim: "Thomas Clarke", victimSide: "IND", attacker: "Spencer Patel", attackerSide: "BLUFOR", weapon: "MXM 6.5 mm", magazine: "6.5mm 30Rnd Mag", distance: 220 },
  { id: 9, frame: 420, time: "0:07:00", type: "endMission", message: "Mission ended — BLUFOR victory" },
];

const CHAT_MESSAGES = [
  { frame: 15, time: "0:00:15", sender: "Cameron Thomson", channel: "Side", side: "BLUFOR", text: "All squads push to objective" },
  { frame: 45, time: "0:00:45", sender: "Jake O'Connor", channel: "Group", side: "BLUFOR", text: "Alpha 1-1 moving to grid 045 082" },
  { frame: 120, time: "0:02:00", sender: "Rashid Karim", channel: "Side", side: "OPFOR", text: "Enemy spotted north of compound" },
  { frame: 200, time: "0:03:20", sender: "Cameron Thomson", channel: "Global", side: "BLUFOR", text: "Contact! Engaging hostiles" },
  { frame: 280, time: "0:04:40", sender: "Jack Reed", channel: "Group", side: "BLUFOR", text: "Alpha 2-1, flanking east" },
];

const MARKERS = [
  { id: 1, playerId: 1, playerName: "Cameron Thomson", text: "Rally Point Alpha", type: "ICON", startFrame: 30, endFrame: 441, side: "BLUFOR" },
  { id: 2, playerId: 1, playerName: "Cameron Thomson", text: "Enemy FOB", type: "ICON", startFrame: 120, endFrame: 441, side: "BLUFOR" },
  { id: 3, playerId: 2, playerName: "Jake O'Connor", text: "Contact N", type: "ICON", startFrame: 80, endFrame: 200, side: "BLUFOR" },
  { id: 4, playerId: 2, playerName: "Jake O'Connor", text: "LMAO GET REKT", type: "ICON", startFrame: 85, endFrame: 441, side: "BLUFOR" },
  { id: 5, playerId: 2, playerName: "Jake O'Connor", text: "XDXDXD", type: "ICON", startFrame: 86, endFrame: 441, side: "BLUFOR" },
  { id: 6, playerId: 2, playerName: "Jake O'Connor", text: "TROLL MARKER 1", type: "ICON", startFrame: 87, endFrame: 441, side: "BLUFOR" },
  { id: 7, playerId: 2, playerName: "Jake O'Connor", text: "TROLL MARKER 2", type: "ICON", startFrame: 88, endFrame: 441, side: "BLUFOR" },
  { id: 8, playerId: 2, playerName: "Jake O'Connor", text: "LOL LOL LOL", type: "ICON", startFrame: 89, endFrame: 441, side: "BLUFOR" },
  { id: 9, playerId: 10, playerName: "Jack Reed", text: "Overwatch pos", type: "ICON", startFrame: 200, endFrame: 441, side: "BLUFOR" },
  { id: 10, playerId: 22, playerName: "Rashid Karim", text: "Defend here", type: "ICON", startFrame: 50, endFrame: 441, side: "OPFOR" },
];

const TOTAL_FRAMES = 441;
const TOTAL_TIME = "0:07:21";
const MISSION_NAME = "MP_COOP_m05";
const MAP_NAME = "Altis";

// ─── Icon Components ─────────────────────────────────────────────────────────
const Icons = {
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>,
  Pause: () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  SkipBack: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>,
  SkipForward: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>,
  StepBack: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>,
  StepForward: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>,
  SkipToKill: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>,
  SkipToKillBack: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>,
  Users: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Activity: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  BarChart: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>,
  MessageSquare: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Scissors: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
  BracketIn: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="8 4 4 4 4 20 8 20"/></svg>,
  BracketOut: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="16 4 20 4 20 20 16 20"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>,
  Crosshair: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>,
  Skull: () => <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2C6.48 2 2 6.48 2 12c0 3.31 1.61 6.24 4.09 8.06V22h3v-1h1.82v1h2.18v-1H15v1h3v-1.94C20.39 18.24 22 15.31 22 12c0-5.52-4.48-10-10-10zM9 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>,
  Zap: () => <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  Link: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  Download: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Share: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  Info: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>,
  ChevronRight: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Layers: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  Map: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Eye: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Radio: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M16.72 11.06A10.94 10.94 0 0 1 19 17.94"/><path d="M7.28 11.06A10.94 10.94 0 0 0 5 17.94"/><path d="M14.34 14.18a7 7 0 0 1 1.66 3.76"/><path d="M9.66 14.18a7 7 0 0 0-1.66 3.76"/><circle cx="12" cy="20" r="2"/><path d="M12 2v8"/></svg>,
  Settings: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Target: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Clock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  MapPin: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  EyeOff: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  Navigation: () => <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="3 11 22 2 13 21 11 13"/></svg>,
  Slash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  AlertTriangle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Steam: () => <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M11.979 0C5.678 0 .511 4.86.022 10.942l6.432 2.658a3.387 3.387 0 0 1 1.912-.588c.063 0 .125.002.188.006l2.861-4.142V8.77a4.508 4.508 0 0 1 4.505-4.505 4.508 4.508 0 0 1 4.505 4.505 4.508 4.508 0 0 1-4.505 4.506h-.105l-4.077 2.91c0 .053.003.106.003.16a3.39 3.39 0 0 1-3.388 3.388 3.393 3.393 0 0 1-3.349-2.868L.2 15.099A11.979 11.979 0 0 0 11.979 24c6.627 0 12-5.373 12-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61a2.54 2.54 0 0 0 4.867-.863 2.542 2.542 0 0 0-2.537-2.54 2.54 2.54 0 0 0-.946.183l1.522.63a1.868 1.868 0 0 1-1.433 3.2zm8.38-6.249a3.005 3.005 0 0 0 3.002-3.002 3.005 3.005 0 0 0-3.002-3.002 3.005 3.005 0 0 0-3.003 3.002 3.005 3.005 0 0 0 3.003 3.002z"/></svg>,
  Shield: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  LogOut: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// ─── Utility ─────────────────────────────────────────────────────────────────
function frameToTime(frame) {
  const totalSec = Math.floor(frame / TOTAL_FRAMES * 441);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const transportBtn = (size = 30) => ({
  width: size, height: size, borderRadius: 6,
  background: "transparent", border: "none",
  color: "#778899", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  transition: "color 0.12s",
});

function getEventIcon(type) {
  switch (type) {
    case "kill": return <Icons.Skull />;
    case "hit": return <Icons.Zap />;
    case "connected": return <Icons.Link />;
    case "disconnected": return <Icons.Link />;
    case "endMission": return <Icons.Target />;
    default: return <Icons.Activity />;
  }
}

function getEventColor(type) {
  switch (type) {
    case "kill": return "#FF4A4A";
    case "hit": return "#FFB84A";
    case "connected": return "#2DD4A0";
    case "disconnected": return "#888";
    case "endMission": return "#A78BFA";
    default: return "#888";
  }
}

// ─── Map Background ──────────────────────────────────────────────────────────
function MapBackground() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `
        radial-gradient(ellipse at 30% 40%, rgba(74,158,255,0.04) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 60%, rgba(255,74,74,0.03) 0%, transparent 60%),
        #0a0f14
      `,
    }}>
      {/* Grid overlay to simulate map */}
      <svg width="100%" height="100%" style={{ opacity: 0.06 }}>
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#4A9EFF" strokeWidth="0.5"/>
          </pattern>
          <pattern id="gridSm" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#4A9EFF" strokeWidth="0.3"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#gridSm)"/>
        <rect width="100%" height="100%" fill="url(#grid)"/>
      </svg>
      {/* Terrain-like shapes */}
      <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, opacity: 0.04 }}>
        <ellipse cx="35%" cy="45%" rx="200" ry="150" fill="#4A9EFF"/>
        <ellipse cx="60%" cy="35%" rx="300" ry="100" fill="#4A9EFF"/>
        <ellipse cx="50%" cy="65%" rx="250" ry="180" fill="#2DD4A0"/>
        <ellipse cx="75%" cy="50%" rx="150" ry="200" fill="#FF4A4A"/>
      </svg>
      {/* Contour lines */}
      <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, opacity: 0.035 }}>
        <ellipse cx="40%" cy="50%" rx="120" ry="80" fill="none" stroke="#fff" strokeWidth="1"/>
        <ellipse cx="40%" cy="50%" rx="160" ry="110" fill="none" stroke="#fff" strokeWidth="1"/>
        <ellipse cx="40%" cy="50%" rx="200" ry="140" fill="none" stroke="#fff" strokeWidth="1"/>
        <ellipse cx="65%" cy="40%" rx="100" ry="60" fill="none" stroke="#fff" strokeWidth="1"/>
        <ellipse cx="65%" cy="40%" rx="140" ry="90" fill="none" stroke="#fff" strokeWidth="1"/>
      </svg>
      {/* Simulated unit dots */}
      <div style={{ position: "absolute", inset: 0 }}>
        {[
          { x: 32, y: 42, side: "BLUFOR", rot: 45 },
          { x: 34, y: 44, side: "BLUFOR", rot: 50 },
          { x: 33, y: 43, side: "BLUFOR", rot: 40 },
          { x: 35, y: 41, side: "BLUFOR", rot: 60 },
          { x: 36, y: 45, side: "BLUFOR", rot: 30 },
          { x: 31, y: 43, side: "BLUFOR", rot: 55 },
          { x: 30, y: 40, side: "BLUFOR", rot: 48 },
          { x: 37, y: 46, side: "BLUFOR", rot: 35 },
          { x: 64, y: 38, side: "OPFOR", rot: 220 },
          { x: 66, y: 40, side: "OPFOR", rot: 210 },
          { x: 63, y: 37, side: "OPFOR", rot: 230 },
          { x: 50, y: 55, side: "IND", rot: 0 },
          { x: 52, y: 54, side: "IND", rot: 10 },
        ].map((u, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${u.x}%`, top: `${u.y}%`,
            transform: `translate(-50%,-50%) rotate(${u.rot}deg)`,
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <polygon points="9,1 14,15 9,12 4,15" fill={SIDES[u.side].color} opacity={0.85} />
            </svg>
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              width: 24, height: 24, borderRadius: "50%",
              background: SIDES[u.side].color, opacity: 0.12,
              transform: "translate(-50%,-50%)",
              animation: `pulse${i%3} 3s ease-in-out infinite ${i*0.2}s`,
            }}/>
          </div>
        ))}
        {/* Fire lines */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <line x1="35%" y1="41%" x2="64%" y2="38%" stroke="#FF4A4A" strokeWidth="1" opacity="0.2" strokeDasharray="4 4">
            <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/>
          </line>
          <line x1="33%" y1="43%" x2="66%" y2="40%" stroke="#4A9EFF" strokeWidth="1" opacity="0.15" strokeDasharray="4 4">
            <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.5s" repeatCount="indefinite"/>
          </line>
        </svg>
      </div>
    </div>
  );
}

// ─── Unit Marker (for the entity list icon) ──────────────────────────────────
function UnitIcon({ side, alive, size = 10 }) {
  const c = SIDES[side]?.color || "#666";
  return (
    <div style={{
      width: size, height: size, borderRadius: 2,
      background: alive ? c : "#444",
      opacity: alive ? 1 : 0.4,
      flexShrink: 0,
    }}/>
  );
}

// ─── Side Tab Button ─────────────────────────────────────────────────────────
function SideTab({ side, count, active, onClick }) {
  const s = SIDES[side];
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 12px", border: "none", borderRadius: 6,
      background: active ? s.bg : "transparent",
      color: active ? s.color : "#666",
      fontSize: 11, fontWeight: 600, cursor: "pointer",
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: "0.05em",
      transition: "all 0.2s",
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: 2,
        background: active ? s.color : "#555",
        transition: "all 0.2s",
      }}/>
      {s.label}
      <span style={{ opacity: 0.6, fontSize: 10 }}>{count}</span>
    </button>
  );
}

// ─── Panel Tab Button ────────────────────────────────────────────────────────
function PanelTab({ icon, label, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "8px 14px", border: "none",
      borderBottom: active ? "2px solid #4A9EFF" : "2px solid transparent",
      background: "transparent",
      color: active ? "#e0e6ed" : "#556677",
      fontSize: 12, fontWeight: 500, cursor: "pointer",
      fontFamily: "'JetBrains Mono', monospace",
      transition: "all 0.2s",
      position: "relative",
    }}>
      {icon}
      <span style={{ fontSize: 11 }}>{label}</span>
      {badge > 0 && (
        <span style={{
          position: "absolute", top: 4, right: 2,
          width: 14, height: 14, borderRadius: "50%",
          background: "#FF4A4A", color: "#fff",
          fontSize: 8, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{badge}</span>
      )}
    </button>
  );
}

// ─── Group Header ────────────────────────────────────────────────────────────
function GroupHeader({ name, count, alive, expanded, onToggle, side }) {
  const c = SIDES[side]?.color || "#fff";
  return (
    <button onClick={onToggle} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      padding: "7px 12px", border: "none", cursor: "pointer",
      background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
      borderLeft: `2px solid ${expanded ? c : "transparent"}`,
      transition: "all 0.2s",
    }}>
      <span style={{ color: "#556677", transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "flex" }}>
        <Icons.ChevronRight />
      </span>
      <span style={{ color: "#8899aa", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>
        {name}
      </span>
      <span style={{ marginLeft: "auto", color: "#445566", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
        <span style={{ color: "#2DD4A0" }}>{alive}</span>
        <span style={{ opacity: 0.4 }}>/{count}</span>
      </span>
    </button>
  );
}

// ─── Unit Row ────────────────────────────────────────────────────────────────
function UnitRow({ unit, side, selected, onClick }) {
  const sideData = SIDES[side];
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      padding: "5px 12px 5px 32px", border: "none", cursor: "pointer",
      background: selected ? "rgba(74,158,255,0.08)" : "transparent",
      transition: "all 0.15s",
      opacity: unit.alive ? 1 : 0.45,
    }}>
      <UnitIcon side={side} alive={unit.alive} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 12, color: unit.alive ? "#c8d4e0" : "#556677",
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {unit.name}
          {!unit.isPlayer && <span style={{ fontSize: 9, color: "#445566", background: "rgba(255,255,255,0.04)", padding: "1px 4px", borderRadius: 3 }}>AI</span>}
        </div>
        <div style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>{unit.role}</div>
      </div>
      {unit.kills > 0 && (
        <div style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 3,
          fontSize: 10, color: "#FF4A4A", fontFamily: "'JetBrains Mono', monospace",
          background: "rgba(255,74,74,0.1)", padding: "2px 6px", borderRadius: 4,
        }}>
          <Icons.Crosshair />
          {unit.kills}
        </div>
      )}
    </button>
  );
}

// ─── Unit Detail Card (inline expand) ────────────────────────────────────────
function UnitDetailCard({ unit, side, markerBlacklist, onToggleMarkers, followedUnit, onToggleFollow, isAdmin }) {
  const sideData = SIDES[side];
  const unitMarkers = MARKERS.filter(m => m.playerId === unit.id);
  const isBlacklisted = markerBlacklist.has(unit.id);
  const isFollowed = followedUnit === unit.id;
  // Non-admins don't see blacklisted marker counts
  const visibleMarkers = isAdmin ? unitMarkers.length : unitMarkers.filter(m => !markerBlacklist.has(m.playerId)).length;

  return (
    <div style={{
      margin: "0 8px 4px 32px", padding: 10, borderRadius: 8,
      background: "rgba(0,0,0,0.25)",
      border: `1px solid ${sideData.color}15`,
      animation: "fadeIn 0.15s ease-out",
    }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
        {[
          { value: unit.kills, label: "Kills", color: unit.kills > 0 ? "#FF4A4A" : "#334455" },
          { value: unit.deaths, label: "Deaths", color: unit.deaths > 0 ? "#FFB84A" : "#334455" },
          { value: visibleMarkers, label: "Markers", color: visibleMarkers > 0 ? "#A78BFA" : "#334455" },
        ].map(stat => (
          <div key={stat.label} style={{
            textAlign: "center", padding: "4px 2px",
            background: "rgba(0,0,0,0.2)", borderRadius: 5,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: stat.color, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 7, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", marginTop: 2, fontWeight: 600 }}>
              {stat.label.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* Regular actions — available to everyone */}
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => onToggleFollow(unit.id)} style={{
          flex: 1, padding: "5px 8px", borderRadius: 6, cursor: "pointer",
          background: isFollowed ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${isFollowed ? "rgba(74,158,255,0.3)" : "rgba(255,255,255,0.06)"}`,
          color: isFollowed ? "#4A9EFF" : "#667788",
          fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          transition: "all 0.15s",
        }}>
          <Icons.Navigation /> {isFollowed ? "Following" : "Follow"}
        </button>
      </div>

      {/* Admin Actions — same pattern as mission selector sidebar */}
      {isAdmin && unitMarkers.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 8, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>
            ADMIN ACTIONS
          </div>
          <button onClick={() => onToggleMarkers(unit.id)} style={{
            width: "100%", padding: "5px 8px", borderRadius: 6, cursor: "pointer",
            background: isBlacklisted ? "rgba(255,74,74,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isBlacklisted ? "rgba(255,74,74,0.15)" : "rgba(255,255,255,0.06)"}`,
            color: isBlacklisted ? "#FF6B6B" : "#667788",
            fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            transition: "all 0.15s",
          }}>
            {isBlacklisted
              ? <><Icons.Eye /> Restore {unitMarkers.length} markers</>
              : <><Icons.EyeOff /> Blacklist {unitMarkers.length} markers</>
            }
          </button>
        </div>
      )}
    </div>
  );
}


function EventRow({ event, onClick }) {
  const color = getEventColor(event.type);
  if (event.type === "kill" || event.type === "hit") {
    return (
      <button onClick={() => onClick(event)} style={{
        display: "flex", gap: 10, padding: "10px 14px", width: "100%",
        border: "none", cursor: "pointer", background: "transparent",
        borderLeft: `2px solid ${color}`,
        transition: "all 0.15s",
      }}>
        <div style={{ color, flexShrink: 0, marginTop: 2 }}>{getEventIcon(event.type)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, alignItems: "flex-start" }}>
          <div style={{ fontSize: 12, color: "#c8d4e0", fontFamily: "'JetBrains Mono', monospace", textAlign: "left" }}>
            <span style={{ color: SIDES[event.victimSide]?.color || "#fff" }}>{event.victim}</span>
            <span style={{ color: "#556677" }}> ← </span>
            <span style={{ color: SIDES[event.attackerSide]?.color || "#fff" }}>{event.attacker}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 3 }}>
              <Icons.Clock /> {event.time}
            </span>
            {event.distance > 0 && (
              <span style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
                {event.distance}m
              </span>
            )}
            <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
              {event.weapon}
            </span>
          </div>
        </div>
      </button>
    );
  }
  return (
    <button onClick={() => onClick(event)} style={{
      display: "flex", gap: 10, padding: "8px 14px", width: "100%",
      border: "none", cursor: "pointer", background: "transparent",
      borderLeft: `2px solid ${color}`,
    }}>
      <div style={{ color, flexShrink: 0, marginTop: 1 }}>{getEventIcon(event.type)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
        <span style={{ fontSize: 11, color: "#8899aa", fontFamily: "'JetBrains Mono', monospace", textAlign: "left" }}>{event.message}</span>
        <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 3 }}>
          <Icons.Clock /> {event.time}
        </span>
      </div>
    </button>
  );
}

// ─── Chat Message ────────────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const channelColors = { Side: "#4A9EFF", Group: "#2DD4A0", Global: "#FFB84A", Direct: "#A78BFA", Vehicle: "#888" };
  return (
    <div style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{
        fontSize: 9, fontWeight: 600, color: channelColors[msg.channel] || "#666",
        background: `${channelColors[msg.channel] || "#666"}18`,
        padding: "2px 5px", borderRadius: 3, flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace", marginTop: 1,
      }}>{msg.channel}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: SIDES[msg.side]?.color || "#888", fontFamily: "'JetBrains Mono', monospace" }}>{msg.sender}</span>
          <span style={{ fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>{msg.time}</span>
        </div>
        <div style={{ fontSize: 12, color: "#99aabb", lineHeight: 1.4 }}>{msg.text}</div>
      </div>
    </div>
  );
}

// ─── Stats Panel Content ─────────────────────────────────────────────────────
function StatsContent() {
  const allUnits = Object.entries(GROUPS).flatMap(([side, groups]) =>
    groups.flatMap(g => g.units.map(u => ({ ...u, side })))
  );
  const sorted = [...allUnits].sort((a, b) => b.kills - a.kills);
  const sideStats = Object.entries(GROUPS).map(([side, groups]) => {
    const units = groups.flatMap(g => g.units);
    return {
      side,
      total: units.length,
      alive: units.filter(u => u.alive).length,
      kills: units.reduce((s, u) => s + u.kills, 0),
      deaths: units.reduce((s, u) => s + u.deaths, 0),
    };
  });
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Force Summary */}
      <div>
        <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 10, fontWeight: 600 }}>
          FORCE SUMMARY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sideStats.map(s => {
            const color = SIDES[s.side]?.color || "#667";
            const dead = s.total - s.alive;
            return (
              <div key={s.side} style={{
                padding: "10px 12px", borderRadius: 8,
                background: SIDES[s.side]?.bg || "rgba(255,255,255,0.03)",
                border: `1px solid ${color}20`,
              }}>
                {/* Side header */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>
                  <span style={{ fontSize: 11, color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                    {SIDES[s.side]?.label || s.side}
                  </span>
                </div>
                {/* Stat grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                  {[
                    { value: s.total, label: "Total", color: "#8899aa" },
                    { value: s.alive, label: "Alive", color: "#2DD4A0" },
                    { value: s.kills, label: "Kills", color: s.kills > 0 ? "#FF4A4A" : "#334455" },
                    { value: s.deaths, label: "Deaths", color: s.deaths > 0 ? "#FFB84A" : "#334455" },
                  ].map(stat => (
                    <div key={stat.label} style={{
                      textAlign: "center", padding: "5px 2px",
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
                        letterSpacing: "0.06em", marginTop: 3, fontWeight: 600,
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

      {/* Leaderboard */}
      <div>
        <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 8, fontWeight: 600 }}>
          LEADERBOARD
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {sorted.filter(u => u.kills > 0 || u.deaths > 0).map((u, i) => (
            <div key={u.id} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
              background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
              borderRadius: 4,
            }}>
              <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace", width: 16, textAlign: "right" }}>
                {i + 1}
              </span>
              <UnitIcon side={u.side} alive={u.alive} />
              <span style={{ fontSize: 11, color: "#c8d4e0", fontFamily: "'JetBrains Mono', monospace", flex: 1 }}>
                {u.name}
              </span>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 11, color: "#FF4A4A", fontFamily: "'JetBrains Mono', monospace", minWidth: 20, textAlign: "right" }}>
                  {u.kills}
                </span>
                <span style={{ fontSize: 11, color: "#FFB84A", fontFamily: "'JetBrains Mono', monospace", minWidth: 20, textAlign: "right" }}>
                  {u.deaths}
                </span>
              </div>
            </div>
          ))}
          {sorted.filter(u => u.kills > 0 || u.deaths > 0).length === 0 && (
            <div style={{ fontSize: 11, color: "#445566", padding: 12, textAlign: "center" }}>No combat data</div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Activity Heatmap ────────────────────────────────────────────────────────
// Bucketizes events into columns showing where action happened
function useActivityHeatmap(events, totalFrames, buckets = 120) {
  return useMemo(() => {
    // Use float boundaries so bucket i's visual position (i/buckets) matches its frame position
    const data = Array.from({ length: buckets }, (_, i) => ({
      frameStart: (i / buckets) * totalFrames,
      frameEnd: ((i + 1) / buckets) * totalFrames,
      kills: 0, hits: 0, other: 0,
    }));
    events.forEach(ev => {
      const idx = Math.min(Math.floor((ev.frame / totalFrames) * buckets), buckets - 1);
      if (ev.type === "kill") data[idx].kills++;
      else if (ev.type === "hit") data[idx].hits++;
      else data[idx].other++;
    });
    const maxVal = Math.max(1, ...data.map(d => d.kills + d.hits + d.other));
    return { data, maxVal };
  }, [events, totalFrames, buckets]);
}

// ─── Timeline Scrubber ───────────────────────────────────────────────────────
function TimelineScrubber({ currentFrame, totalFrames, events, onSeek, playing, formatTime: fmt, focusRange, editingFocus, focusDraft, onDraftChange }) {
  const barRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState(null); // "in" | "out" | null
  const [hoverFrame, setHoverFrame] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  const { data: heatmap, maxVal } = useActivityHeatmap(events, totalFrames);

  const pctFromEvent = useCallback((e) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (draggingHandle) return; // don't seek while dragging handle
    setDragging(true);
    e.target.setPointerCapture(e.pointerId);
    const pct = pctFromEvent(e);
    onSeek(Math.round(pct * totalFrames));
  }, [totalFrames, onSeek, pctFromEvent, draggingHandle]);

  const handlePointerMove = useCallback((e) => {
    const pct = pctFromEvent(e);
    const frame = Math.round(pct * totalFrames);
    setHoverFrame(frame);
    setHoverX(pct * 100);
    if (draggingHandle && focusDraft && onDraftChange) {
      if (draggingHandle === "in") {
        onDraftChange({ ...focusDraft, inFrame: Math.min(frame, focusDraft.outFrame - 5) });
      } else {
        onDraftChange({ ...focusDraft, outFrame: Math.max(frame, focusDraft.inFrame + 5) });
      }
    } else if (dragging) {
      onSeek(frame);
    }
  }, [dragging, draggingHandle, totalFrames, onSeek, pctFromEvent, focusDraft, onDraftChange]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    setDraggingHandle(null);
  }, []);
  const handlePointerLeave = useCallback(() => {
    setHoverFrame(null);
    setDragging(false);
    setDraggingHandle(null);
  }, []);

  const progress = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;
  const killEvents = events.filter(e => e.type === "kill");

  // Events near hover position for tooltip
  const hoverEvents = useMemo(() => {
    if (hoverFrame === null) return [];
    const range = Math.max(3, Math.round(totalFrames / 80));
    return events.filter(e => Math.abs(e.frame - hoverFrame) < range).slice(0, 3);
  }, [hoverFrame, events, totalFrames]);

  // Active focus range (draft during editing, saved otherwise)
  const focus = editingFocus ? focusDraft : focusRange;
  const focusInPct = focus ? (focus.inFrame / totalFrames) * 100 : 0;
  const focusOutPct = focus ? (focus.outFrame / totalFrames) * 100 : 100;

  const HEATMAP_H = 28;
  const BAR_H = 4;
  const HANDLE_W = 8;
  const GOLD = "#D4A843";
  const GOLD_DIM = "rgba(212,168,67,0.3)";

  // Stripe pattern for dimmed regions
  const stripesBg = `repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.25) 3px,
    rgba(0,0,0,0.25) 5px
  )`;

  return (
    <div style={{ position: "relative", width: "100%", userSelect: "none" }}>
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{
          width: "100%", height: HEATMAP_H + BAR_H + 4,
          cursor: draggingHandle ? "ew-resize" : "pointer",
          position: "relative",
          padding: "0",
        }}
      >
        {/* Activity heatmap bars */}
        <div style={{
          position: "absolute", bottom: BAR_H + 2, left: 0, right: 0, height: HEATMAP_H,
          display: "flex", alignItems: "flex-end", gap: 1,
        }}>
          {heatmap.map((bucket, i) => {
            const total = bucket.kills + bucket.hits + bucket.other;
            if (total === 0) return <div key={i} style={{ flex: 1, minWidth: 0 }} />;
            const h = Math.max(2, (total / maxVal) * HEATMAP_H);
            const isPast = bucket.frameEnd <= currentFrame;
            // If focus exists, dim bars outside range further
            const bucketMid = (bucket.frameStart + bucket.frameEnd) / 2;
            const isOutsideFocus = focus && (bucketMid < focus.inFrame || bucketMid > focus.outFrame);
            const baseOpacity = isPast ? 0.8 : 0.35;
            const opacity = isOutsideFocus ? baseOpacity * 0.3 : baseOpacity;
            const killH = (bucket.kills / total) * h;
            const hitH = (bucket.hits / total) * h;
            const otherH = h - killH - hitH;
            return (
              <div key={i} style={{
                flex: 1, minWidth: 0, height: h, borderRadius: "1px 1px 0 0",
                display: "flex", flexDirection: "column", justifyContent: "flex-end",
                opacity,
                transition: "opacity 0.15s",
              }}>
                {bucket.other > 0 && <div style={{ height: otherH, background: "#445566", borderRadius: "1px 1px 0 0" }} />}
                {bucket.hits > 0 && <div style={{ height: hitH, background: "#FFB84A" }} />}
                {bucket.kills > 0 && <div style={{ height: killH, background: "#FF4A4A" }} />}
              </div>
            );
          })}
        </div>

        {/* Focus dimming overlays (striped) */}
        {focus && (
          <>
            {/* Left dim region */}
            {focusInPct > 0 && (
              <div style={{
                position: "absolute", top: 0, left: 0, bottom: 0,
                width: `${focusInPct}%`,
                background: stripesBg,
                pointerEvents: "none", zIndex: 3,
                borderRight: editingFocus ? `1px solid ${GOLD_DIM}` : "none",
              }}/>
            )}
            {/* Right dim region */}
            {focusOutPct < 100 && (
              <div style={{
                position: "absolute", top: 0, right: 0, bottom: 0,
                width: `${100 - focusOutPct}%`,
                background: stripesBg,
                pointerEvents: "none", zIndex: 3,
                borderLeft: editingFocus ? `1px solid ${GOLD_DIM}` : "none",
              }}/>
            )}
            {/* Focus range top/bottom border (gold accent line) */}
            {!editingFocus && (
              <div style={{
                position: "absolute", top: 0,
                left: `${focusInPct}%`, width: `${focusOutPct - focusInPct}%`,
                height: 1, background: GOLD_DIM,
                pointerEvents: "none", zIndex: 4,
              }}/>
            )}
            {/* Editing: gold border around focus region */}
            {editingFocus && (
              <div style={{
                position: "absolute",
                left: `${focusInPct}%`, width: `${focusOutPct - focusInPct}%`,
                top: -1, bottom: -1,
                border: `1.5px dashed ${GOLD}`,
                borderRadius: 2,
                pointerEvents: "none", zIndex: 4,
                boxShadow: `0 0 12px rgba(212,168,67,0.15)`,
              }}/>
            )}
          </>
        )}

        {/* Scrub track */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: BAR_H,
          background: "rgba(255,255,255,0.06)", borderRadius: 2,
        }}>
          {/* Progress fill */}
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%", borderRadius: 2,
            width: `${progress}%`,
            background: "linear-gradient(90deg, #4A9EFF, #60b4ff)",
            transition: dragging || draggingHandle ? "none" : "width 0.08s linear",
          }}/>
        </div>

        {/* Kill tick marks on the track */}
        {killEvents.map((ev, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${(ev.frame / totalFrames) * 100}%`,
            bottom: 0, width: 2, height: BAR_H + 3,
            background: "#FF4A4A",
            opacity: 0.6,
            borderRadius: 1,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}/>
        ))}

        {/* Playhead line */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${progress}%`,
          width: 2, transform: "translateX(-50%)",
          background: "#4A9EFF",
          boxShadow: "0 0 8px rgba(74,158,255,0.4)",
          transition: dragging || draggingHandle ? "none" : "left 0.08s linear",
          pointerEvents: "none",
          borderRadius: 1,
          zIndex: 6,
        }}>
          {/* Playhead knob */}
          <div style={{
            position: "absolute", bottom: -2,
            left: "50%", transform: "translateX(-50%)",
            width: 10, height: 10, borderRadius: "50%",
            background: "#4A9EFF",
            border: "2px solid #0d1520",
            boxShadow: "0 0 6px rgba(74,158,255,0.5)",
          }}/>
        </div>

        {/* ── Focus Range Handles (edit mode only) ─── */}
        {editingFocus && focusDraft && (
          <>
            {/* In handle */}
            <div
              onPointerDown={(e) => { e.stopPropagation(); setDraggingHandle("in"); e.target.setPointerCapture(e.pointerId); }}
              style={{
                position: "absolute",
                left: `${focusInPct}%`,
                top: -3, bottom: -3,
                width: HANDLE_W,
                transform: "translateX(-100%)",
                background: GOLD,
                borderRadius: "3px 0 0 3px",
                cursor: "ew-resize",
                zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 0 8px rgba(212,168,67,0.4)`,
              }}
            >
              <div style={{ width: 2, height: 14, borderRadius: 1, background: "rgba(0,0,0,0.3)" }}/>
            </div>
            {/* Out handle */}
            <div
              onPointerDown={(e) => { e.stopPropagation(); setDraggingHandle("out"); e.target.setPointerCapture(e.pointerId); }}
              style={{
                position: "absolute",
                left: `${focusOutPct}%`,
                top: -3, bottom: -3,
                width: HANDLE_W,
                background: GOLD,
                borderRadius: "0 3px 3px 0",
                cursor: "ew-resize",
                zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 0 8px rgba(212,168,67,0.4)`,
              }}
            >
              <div style={{ width: 2, height: 14, borderRadius: 1, background: "rgba(0,0,0,0.3)" }}/>
            </div>
            {/* In/Out time labels */}
            <div style={{
              position: "absolute", top: -16,
              left: `${focusInPct}%`, transform: "translateX(-50%)",
              fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
              color: GOLD, fontWeight: 600, pointerEvents: "none", zIndex: 11,
            }}>
              {(fmt || frameToTime)(focusDraft.inFrame)}
            </div>
            <div style={{
              position: "absolute", top: -16,
              left: `${focusOutPct}%`, transform: "translateX(-50%)",
              fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
              color: GOLD, fontWeight: 600, pointerEvents: "none", zIndex: 11,
            }}>
              {(fmt || frameToTime)(focusDraft.outFrame)}
            </div>
          </>
        )}

        {/* Non-edit focus indicators (subtle gold ticks) */}
        {!editingFocus && focus && (
          <>
            <div style={{
              position: "absolute", left: `${focusInPct}%`, top: 0, bottom: 0,
              width: 1.5, background: GOLD_DIM, pointerEvents: "none", zIndex: 4,
            }}/>
            <div style={{
              position: "absolute", left: `${focusOutPct}%`, top: 0, bottom: 0,
              width: 1.5, background: GOLD_DIM, pointerEvents: "none", zIndex: 4,
            }}/>
          </>
        )}

        {/* Hover line + tooltip */}
        {hoverFrame !== null && !dragging && !draggingHandle && (
          <>
            <div style={{
              position: "absolute", top: 0, bottom: 0,
              left: `${hoverX}%`, width: 1,
              background: "rgba(255,255,255,0.15)",
              pointerEvents: "none", transform: "translateX(-50%)",
            }}/>
            <div style={{
              position: "absolute", bottom: HEATMAP_H + BAR_H + 10,
              left: `${hoverX}%`, transform: "translateX(-50%)",
              background: "rgba(13,21,32,0.95)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6, padding: "5px 9px",
              pointerEvents: "none", whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              zIndex: 30,
            }}>
              <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#e0e6ed", fontWeight: 600 }}>
                {(fmt || frameToTime)(hoverFrame)}
              </div>
              {hoverEvents.length > 0 && (
                <div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 1 }}>
                  {hoverEvents.map((ev, i) => (
                    <div key={i} style={{
                      fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                      color: ev.type === "kill" ? "#FF6B6B" : ev.type === "hit" ? "#FFB84A" : "#556677",
                    }}>
                      {ev.type === "kill" && `☠ ${ev.victim}`}
                      {ev.type === "hit" && `⚡ ${ev.victim}`}
                      {ev.type === "connected" && `→ ${ev.message}`}
                      {ev.type === "endMission" && `■ ${ev.message}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline Speed Control ───────────────────────────────────────────────────
function SpeedSelector({ speed, onSpeedChange }) {
  const speeds = [1, 2, 5, 10, 20, 60];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1, background: "rgba(255,255,255,0.03)", borderRadius: 5, padding: 2, border: "1px solid rgba(255,255,255,0.04)" }}>
      {speeds.map(s => (
        <button key={s} onClick={() => onSpeedChange(s)} style={{
          padding: "3px 7px", borderRadius: 4, border: "none", cursor: "pointer",
          background: s === speed ? "rgba(74,158,255,0.15)" : "transparent",
          color: s === speed ? "#4A9EFF" : "#556677",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          fontWeight: s === speed ? 700 : 500,
          transition: "all 0.12s",
          minWidth: 28,
        }}>
          {s}×
        </button>
      ))}
    </div>
  );
}


// ─── View Settings ──────────────────────────────────────────────────────────
function ViewSettings({ layers, onToggle, timeMode, onTimeMode, unitLabels, onUnitLabels, markerMode, onMarkerMode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const SectionLabel = ({ children }) => (
    <div style={{
      fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: "0.1em", fontWeight: 700, padding: "8px 8px 4px",
      borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: 4,
    }}>{children}</div>
  );

  const RadioGroup = ({ value, onChange, options }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 4px" }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "5px 8px", border: "none", borderRadius: 4,
          background: value === opt.value ? "rgba(74,158,255,0.06)" : "transparent",
          cursor: "pointer", transition: "all 0.12s",
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: "50%",
            border: `1.5px solid ${value === opt.value ? "#4A9EFF" : "#334455"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.12s",
          }}>
            {value === opt.value && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4A9EFF" }} />}
          </div>
          <span style={{
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            color: value === opt.value ? "#c8d4e0" : "#667788",
          }}>{opt.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: 36, height: 36, borderRadius: 8,
        background: open ? "rgba(74,158,255,0.12)" : "rgba(13,21,32,0.85)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${open ? "rgba(74,158,255,0.2)" : "rgba(255,255,255,0.08)"}`,
        cursor: "pointer",
        color: open ? "#4A9EFF" : "#8899aa",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
      }}>
        <Icons.Settings />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 6,
          background: "rgba(13,21,32,0.95)", backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          padding: "8px 6px", minWidth: 220, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          zIndex: 100, animation: "fadeIn 0.12s ease-out",
          maxHeight: "70vh", overflowY: "auto",
        }}>
          {/* Map Layers */}
          <div style={{
            fontSize: 9, color: "#445566", fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.1em", fontWeight: 700, padding: "4px 8px 4px",
          }}>MAP LAYERS</div>
          {Object.entries(layers).map(([key, val]) => (
            <button key={key} onClick={() => onToggle(key)} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "5px 8px", border: "none", borderRadius: 4,
              background: "transparent", cursor: "pointer",
              transition: "all 0.12s",
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                border: `1.5px solid ${val ? "#4A9EFF" : "#334455"}`,
                background: val ? "rgba(74,158,255,0.15)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.12s",
              }}>
                {val && <div style={{ width: 7, height: 7, borderRadius: 1.5, background: "#4A9EFF" }}/>}
              </div>
              <span style={{
                fontSize: 11, color: val ? "#c8d4e0" : "#556677",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            </button>
          ))}

          {/* Time Format */}
          <SectionLabel>TIME FORMAT</SectionLabel>
          <RadioGroup value={timeMode} onChange={onTimeMode} options={[
            { value: "elapsed", label: "Recording elapsed" },
            { value: "ingame", label: "In-game elapsed" },
            { value: "utc", label: "Server time (UTC)" },
          ]} />

          {/* Unit Labels */}
          <SectionLabel>UNIT LABELS</SectionLabel>
          <RadioGroup value={unitLabels} onChange={onUnitLabels} options={[
            { value: "all", label: "All names" },
            { value: "players", label: "Players only" },
            { value: "hidden", label: "Hide all" },
          ]} />

          {/* Markers */}
          <SectionLabel>MARKERS</SectionLabel>
          <RadioGroup value={markerMode} onChange={onMarkerMode} options={[
            { value: "full", label: "Markers & labels" },
            { value: "icons", label: "Markers only" },
            { value: "hidden", label: "Hide markers" },
          ]} />
        </div>
      )}
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────────────────────
export default function OCAP2Redesign() {
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(340);
  const [speed, setSpeed] = useState(10);
  const [activeSide, setActiveSide] = useState("BLUFOR");
  const [activeTab, setActiveTab] = useState("units");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [markerBlacklist, setMarkerBlacklist] = useState(new Set());
  const [followedUnit, setFollowedUnit] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set(["Alpha 1-1", "Alpha 1-2", "Alpha 1-3", "Alpha 2-1", "Alpha 2-2", "Bravo 1-1", "Charlie 1-1"]));
  const [eventFilter, setEventFilter] = useState("");
  const [showHits, setShowHits] = useState(true);
  const [showConnects, setShowConnects] = useState(false);
  const [layers, setLayers] = useState({
    "Units": true,
    "FireLines": true,
    "KillLines": true,
    "Markers": true,
    "ProjectileTrails": false,
    "CoordinateGrid": false,
    "3DBuildings": true,
  });
  const [timeMode, setTimeMode] = useState("elapsed");       // elapsed | ingame | utc
  const [unitLabels, setUnitLabels] = useState("all");        // all | players | hidden
  const [markerMode, setMarkerMode] = useState("full");       // full | icons | hidden

  // Focus Range: admin-defined "interesting part" of the recording
  // Mock: saved range skipping prep phase (first ~50 frames) and post-mission (last ~21 frames)
  const [focusRange, setFocusRange] = useState({ inFrame: 50, outFrame: 420 });  // null = no range saved
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState(null);  // {inFrame, outFrame} during editing
  const [showFullTimeline, setShowFullTimeline] = useState(false); // viewer toggle to ignore focus

  // Playback simulation
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setCurrentFrame(f => {
        if (f >= TOTAL_FRAMES) { setPlaying(false); return TOTAL_FRAMES; }
        return Math.min(TOTAL_FRAMES, f + 1);
      });
    }, 1000 / speed);
    return () => clearInterval(interval);
  }, [playing, speed]);

  // Keyboard shortcuts
  useEffect(() => {
    const killFrames = EVENTS.filter(e => e.type === "kill").map(e => e.frame).sort((a, b) => a - b);
    const handler = (e) => {
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === "e" || e.key === "E") setLeftPanelOpen(p => !p);
      // Frame step: arrow keys (hold shift for 10-frame jumps)
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setCurrentFrame(f => Math.max(0, f - (e.shiftKey ? 10 : 1)));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setCurrentFrame(f => Math.min(TOTAL_FRAMES, f + (e.shiftKey ? 10 : 1)));
      }
      // Jump to next/prev kill: , and .
      if (e.key === ",") {
        const prev = [...killFrames].reverse().find(f => f < currentFrame);
        if (prev !== undefined) setCurrentFrame(prev);
      }
      if (e.key === ".") {
        const next = killFrames.find(f => f > currentFrame);
        if (next !== undefined) setCurrentFrame(next);
      }
      // Focus range editing: I = set in, O = set out
      if (editingFocus && focusDraft) {
        if (e.key === "i" || e.key === "I") {
          setFocusDraft(d => ({ ...d, inFrame: Math.min(currentFrame, d.outFrame - 1) }));
        }
        if (e.key === "o" || e.key === "O") {
          setFocusDraft(d => ({ ...d, outFrame: Math.max(currentFrame, d.inFrame + 1) }));
        }
        if (e.key === "Escape") {
          setEditingFocus(false);
          setFocusDraft(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentFrame, editingFocus, focusDraft]);

  const toggleGroup = (name) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleMarkerBlacklist = (unitId) => {
    setMarkerBlacklist(prev => {
      const next = new Set(prev);
      next.has(unitId) ? next.delete(unitId) : next.add(unitId);
      return next;
    });
  };

  const toggleFollow = (unitId) => {
    setFollowedUnit(prev => prev === unitId ? null : unitId);
  };

  const handleSteamLogin = () => {
    setIsAdmin(true);
    setAdminUser({ name: "Florian", steamId: "76561198012345678" });
  };
  const handleLogout = () => { setIsAdmin(false); setAdminUser(null); };

  // Focus range editing
  const startFocusEdit = () => {
    setEditingFocus(true);
    setFocusDraft(focusRange ? { ...focusRange } : { inFrame: 0, outFrame: TOTAL_FRAMES });
  };
  const saveFocusRange = () => {
    if (focusDraft) setFocusRange({ ...focusDraft });
    setEditingFocus(false);
    setFocusDraft(null);
  };
  const cancelFocusEdit = () => {
    setEditingFocus(false);
    setFocusDraft(null);
  };
  const clearFocusRange = () => {
    setFocusRange(null);
    setEditingFocus(false);
    setFocusDraft(null);
  };

  const sideUnits = GROUPS[activeSide] || [];
  const totalUnits = sideUnits.reduce((s, g) => s + g.units.length, 0);

  const filteredEvents = EVENTS.filter(e => {
    if (!showHits && e.type === "hit") return false;
    if (!showConnects && (e.type === "connected" || e.type === "disconnected")) return false;
    if (eventFilter) {
      const search = eventFilter.toLowerCase();
      if (e.victim && e.victim.toLowerCase().includes(search)) return true;
      if (e.attacker && e.attacker.toLowerCase().includes(search)) return true;
      if (e.message && e.message.toLowerCase().includes(search)) return true;
      if (e.weapon && e.weapon.toLowerCase().includes(search)) return true;
      return false;
    }
    return true;
  }).sort((a, b) => b.frame - a.frame);

  // Time display based on mode
  const formatTime = useCallback((frame) => {
    const totalSec = Math.floor(frame / TOTAL_FRAMES * 441);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (timeMode === "elapsed") return `${m}:${String(s).padStart(2, "0")}`;
    if (timeMode === "ingame") {
      // Mock in-game time: mission starts at 06:00 game time, 1 frame = 1 real second
      const gameHour = 6 + Math.floor(totalSec / 3600);
      const gameMin = Math.floor((totalSec % 3600) / 60);
      return `${String(gameHour).padStart(2, "0")}:${String(gameMin).padStart(2, "0")}`;
    }
    // utc: mission started at 19:42:15 UTC
    const base = new Date("2025-03-01T19:42:15Z");
    base.setSeconds(base.getSeconds() + totalSec);
    return `${String(base.getUTCHours()).padStart(2, "0")}:${String(base.getUTCMinutes()).padStart(2, "0")}:${String(base.getUTCSeconds()).padStart(2, "0")}`;
  }, [timeMode]);

  const currentTime = formatTime(currentFrame);
  const totalTimeDisplay = formatTime(TOTAL_FRAMES);

  return (
    <div style={{
      width: "100vw", height: "100vh", overflow: "hidden",
      fontFamily: "'Segoe UI', -apple-system, sans-serif",
      background: "#0a0f14", color: "#c8d4e0", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        *::-webkit-scrollbar { width: 4px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        button:hover { filter: brightness(1.15); }
        @keyframes pulse0 { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.12; } 50% { transform: translate(-50%,-50%) scale(1.5); opacity: 0.04; } }
        @keyframes pulse1 { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.1; } 50% { transform: translate(-50%,-50%) scale(1.8); opacity: 0.02; } }
        @keyframes pulse2 { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.15; } 50% { transform: translate(-50%,-50%) scale(1.3); opacity: 0.05; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>

      {/* ── Map Background ─────────────────────────────── */}
      <MapBackground />

      {/* Follow indicator */}
      {followedUnit && (() => {
        const allUnits = Object.entries(GROUPS).flatMap(([side, groups]) =>
          groups.flatMap(g => g.units.map(u => ({ ...u, side })))
        );
        const unit = allUnits.find(u => u.id === followedUnit);
        return unit ? (
          <div style={{
            position: "absolute", bottom: 88, left: 390,
            zIndex: 20, display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(13,21,32,0.9)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(74,158,255,0.2)",
            animation: "fadeIn 0.2s ease-out",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: SIDES[unit.side]?.color || "#4A9EFF" }}/>
            <span style={{ fontSize: 11, color: "#4A9EFF", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              Following
            </span>
            <span style={{ fontSize: 11, color: "#c8d4e0", fontFamily: "'JetBrains Mono', monospace" }}>
              {unit.name}
            </span>
            <button onClick={() => setFollowedUnit(null)} style={{
              background: "none", border: "none", cursor: "pointer", color: "#556677",
              display: "flex", marginLeft: 4,
            }}>
              <Icons.X />
            </button>
          </div>
        ) : null;
      })()}

      {/* Marker blacklist indicator on map — admin only */}
      {isAdmin && markerBlacklist.size > 0 && (
        <div style={{
          position: "absolute", top: 56, right: 8, zIndex: 20,
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 6,
          background: "rgba(255,74,74,0.1)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,74,74,0.15)",
          animation: "fadeIn 0.15s ease-out",
        }}>
          <Icons.EyeOff />
          <span style={{ fontSize: 10, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>
            {MARKERS.filter(m => markerBlacklist.has(m.playerId)).length} markers blacklisted
          </span>
        </div>
      )}

      {/* ── Top Bar ────────────────────────────────────── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 48,
        background: "linear-gradient(180deg, rgba(10,15,20,0.95) 0%, rgba(10,15,20,0.7) 100%)",
        backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 20,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        animation: "fadeIn 0.4s ease-out",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Logo mark */}
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "linear-gradient(135deg, #4A9EFF, #2DD4A0)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#0a0f14",
            fontFamily: "'JetBrains Mono', monospace",
          }}>O2</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e0e6ed", fontFamily: "'Outfit', sans-serif", letterSpacing: "0.02em" }}>
              {MISSION_NAME}
            </div>
            <div style={{ fontSize: 10, color: "#556677", fontFamily: "'JetBrains Mono', monospace" }}>
              {MAP_NAME} · {TOTAL_TIME}
            </div>
          </div>
        </div>

        {/* Center: Side score indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {Object.entries(GROUPS).map(([side, groups]) => {
            const alive = groups.flatMap(g => g.units).filter(u => u.alive).length;
            const total = groups.flatMap(g => g.units).length;
            return (
              <div key={side} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: 2, background: SIDES[side].color }}/>
                <span style={{ fontSize: 12, fontWeight: 600, color: SIDES[side].color, fontFamily: "'JetBrains Mono', monospace" }}>
                  {alive}
                </span>
                <span style={{ fontSize: 10, color: "#445566", fontFamily: "'JetBrains Mono', monospace" }}>/{total}</span>
              </div>
            );
          })}
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Admin / Login */}
          {isAdmin ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px 4px 5px", borderRadius: 7,
              background: "rgba(45,212,160,0.06)",
              border: "1px solid rgba(45,212,160,0.12)",
              marginRight: 4,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 5,
                background: "linear-gradient(135deg, #2DD4A0, #1a9a74)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#0a0f14", fontSize: 9, fontWeight: 700,
                fontFamily: "'Outfit', sans-serif",
              }}>
                {adminUser?.name?.[0] || "A"}
              </div>
              <div style={{ lineHeight: 1 }}>
                <div style={{ fontSize: 10, color: "#e0e6ed", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                  {adminUser?.name || "Admin"}
                </div>
                <div style={{ fontSize: 7, color: "#2DD4A0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", fontWeight: 600, display: "flex", alignItems: "center", gap: 2 }}>
                  <Icons.Shield /> ADMIN
                </div>
              </div>
              <button onClick={handleLogout} title="Sign out" style={{
                width: 22, height: 22, borderRadius: 5, cursor: "pointer", marginLeft: 2,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#556677", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icons.LogOut />
              </button>
            </div>
          ) : (
            <button onClick={handleSteamLogin} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 7, cursor: "pointer",
              background: "linear-gradient(135deg, #171a21, #1b2838)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#c7d5e0", fontSize: 11, marginRight: 4,
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
              transition: "all 0.15s",
            }}>
              <Icons.Steam />
              Sign in
            </button>
          )}

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.06)" }}/>

          <ViewSettings
            layers={layers} onToggle={(k) => setLayers(prev => ({ ...prev, [k]: !prev[k] }))}
            timeMode={timeMode} onTimeMode={setTimeMode}
            unitLabels={unitLabels} onUnitLabels={setUnitLabels}
            markerMode={markerMode} onMarkerMode={setMarkerMode}
          />
          {[
            { icon: <Icons.Download />, label: "Download" },
            { icon: <Icons.Share />, label: "Share" },
            { icon: <Icons.Info />, label: "Info" },
          ].map((btn, i) => (
            <button key={i} title={btn.label} style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer", color: "#8899aa",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {btn.icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── Left Panel ─────────────────────────────────── */}
      {leftPanelOpen && (
        <div style={{
          position: "absolute", top: 56, left: 8, bottom: 80,
          width: 370, display: "flex", flexDirection: "column",
          background: "rgba(13,21,32,0.88)", backdropFilter: "blur(16px)",
          borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)",
          zIndex: 15, overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          animation: "slideInLeft 0.3s ease-out",
        }}>
          {/* Tabs */}
          <div style={{
            display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)",
            padding: "0 4px", flexShrink: 0,
          }}>
            <PanelTab icon={<Icons.Users />} label="Units" active={activeTab === "units"} onClick={() => setActiveTab("units")} />
            <PanelTab icon={<Icons.Activity />} label="Events" active={activeTab === "events"} onClick={() => setActiveTab("events")}
              badge={EVENTS.filter(e => e.type === "kill").length}
            />
            <PanelTab icon={<Icons.BarChart />} label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
            <PanelTab icon={<Icons.MessageSquare />} label="Chat" active={activeTab === "chat"} onClick={() => setActiveTab("chat")} />
          </div>

          {/* Units Tab */}
          {activeTab === "units" && (
            <>
              {/* Side Tabs */}
              <div style={{
                display: "flex", gap: 4, padding: "8px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0,
              }}>
                {Object.entries(GROUPS).map(([side, groups]) => (
                  <SideTab
                    key={side} side={side}
                    count={groups.flatMap(g => g.units).length}
                    active={activeSide === side}
                    onClick={() => setActiveSide(side)}
                  />
                ))}
              </div>
              {/* Unit List */}
              <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                {sideUnits.map(group => {
                  const expanded = expandedGroups.has(group.name);
                  const alive = group.units.filter(u => u.alive).length;
                  return (
                    <div key={group.name}>
                      <GroupHeader
                        name={group.name} count={group.units.length}
                        alive={alive} expanded={expanded}
                        onToggle={() => toggleGroup(group.name)}
                        side={activeSide}
                      />
                      {expanded && group.units.map(unit => (
                        <React.Fragment key={unit.id}>
                          <UnitRow
                            unit={unit} side={activeSide}
                            selected={selectedUnit === unit.id}
                            onClick={() => setSelectedUnit(selectedUnit === unit.id ? null : unit.id)}
                          />
                          {selectedUnit === unit.id && (
                            <UnitDetailCard
                              unit={unit}
                              side={activeSide}
                              markerBlacklist={markerBlacklist}
                              onToggleMarkers={toggleMarkerBlacklist}
                              followedUnit={followedUnit}
                              onToggleFollow={toggleFollow}
                              isAdmin={isAdmin}
                            />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Events Tab */}
          {activeTab === "events" && (
            <>
              <div style={{
                display: "flex", gap: 6, padding: "8px 10px", flexShrink: 0,
                borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center",
              }}>
                <input
                  type="text" placeholder="Filter events..."
                  value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}
                  style={{
                    flex: 1, background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
                    padding: "6px 10px", color: "#c8d4e0", fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace", outline: "none",
                  }}
                />
                <button onClick={() => setShowHits(!showHits)} style={{
                  padding: "4px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: showHits ? "rgba(255,184,74,0.15)" : "rgba(255,255,255,0.04)",
                  color: showHits ? "#FFB84A" : "#556677",
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                }}>
                  Hits
                </button>
                <button onClick={() => setShowConnects(!showConnects)} style={{
                  padding: "4px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                  background: showConnects ? "rgba(45,212,160,0.15)" : "rgba(255,255,255,0.04)",
                  color: showConnects ? "#2DD4A0" : "#556677",
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                }}>
                  Conn
                </button>
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {filteredEvents.map(ev => (
                  <EventRow key={ev.id} event={ev} onClick={() => setCurrentFrame(ev.frame)} />
                ))}
              </div>
            </>
          )}

          {/* Stats Tab */}
          {activeTab === "stats" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <StatsContent />
            </div>
          )}

          {/* Chat Tab */}
          {activeTab === "chat" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {CHAT_MESSAGES.map((msg, i) => (
                <ChatMessage key={i} msg={msg} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Map Controls (right side) ──────────────────── */}
      <div style={{
        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
        display: "flex", flexDirection: "column", gap: 2, zIndex: 15,
      }}>
        {["+", "−"].map((label, i) => (
          <button key={i} style={{
            width: 36, height: 36, borderRadius: 8,
            background: "rgba(13,21,32,0.85)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#8899aa", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 300,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Map Style Switcher ─────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 86, right: 12,
        display: "flex", gap: 4, zIndex: 15,
      }}>
        {["Topo", "Dark", "Relief", "Sat"].map((name, i) => (
          <button key={i} style={{
            width: 36, height: 36, borderRadius: 8,
            background: i === 1 ? "rgba(74,158,255,0.15)" : "rgba(13,21,32,0.85)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${i === 1 ? "rgba(74,158,255,0.3)" : "rgba(255,255,255,0.08)"}`,
            color: i === 1 ? "#4A9EFF" : "#556677", fontSize: 8, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            letterSpacing: "0.02em",
          }}>
            {name}
          </button>
        ))}
      </div>

      {/* ── Bottom Playback Bar ────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "linear-gradient(0deg, rgba(8,12,17,0.98) 0%, rgba(8,12,17,0.92) 60%, rgba(8,12,17,0) 100%)",
        zIndex: 20, display: "flex", flexDirection: "column",
        padding: "24px 20px 0",
      }}>
        {/* Timeline with heatmap */}
        <div style={{ padding: "0 0 6px" }}>
          <TimelineScrubber
            currentFrame={currentFrame}
            totalFrames={TOTAL_FRAMES}
            events={EVENTS}
            onSeek={setCurrentFrame}
            playing={playing}
            formatTime={formatTime}
            focusRange={showFullTimeline ? null : focusRange}
            editingFocus={editingFocus}
            focusDraft={focusDraft}
            onDraftChange={setFocusDraft}
          />
        </div>

        {/* Focus Edit Toolbar (shown when editing) */}
        {editingFocus && focusDraft && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 0 6px",
            borderBottom: "1px solid rgba(212,168,67,0.1)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icons.Scissors />
              <span style={{
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: "#D4A843", fontWeight: 600,
              }}>Focus Range</span>
              <span style={{
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                color: "#887744",
              }}>
                {formatTime(focusDraft.inFrame)} → {formatTime(focusDraft.outFrame)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                title="Set in-point to playhead  [ I ]"
                onClick={() => setFocusDraft(d => ({ ...d, inFrame: Math.min(currentFrame, d.outFrame - 1) }))}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(212,168,67,0.2)",
                  background: "rgba(212,168,67,0.08)", cursor: "pointer",
                  color: "#D4A843", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                }}
              >
                <Icons.BracketIn /> Set In
              </button>
              <button
                title="Set out-point to playhead  [ O ]"
                onClick={() => setFocusDraft(d => ({ ...d, outFrame: Math.max(currentFrame, d.inFrame + 1) }))}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(212,168,67,0.2)",
                  background: "rgba(212,168,67,0.08)", cursor: "pointer",
                  color: "#D4A843", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                }}
              >
                <Icons.BracketOut /> Set Out
              </button>

              <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.06)", margin: "0 4px" }} />

              <button onClick={clearFocusRange} style={{
                padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent", cursor: "pointer",
                color: "#667788", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
              }}>
                Clear
              </button>
              <button onClick={cancelFocusEdit} style={{
                padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.06)",
                background: "transparent", cursor: "pointer",
                color: "#667788", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
              }}>
                Cancel
              </button>
              <button onClick={saveFocusRange} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 10px", borderRadius: 4, border: "none",
                background: "rgba(212,168,67,0.2)", cursor: "pointer",
                color: "#D4A843", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
              }}>
                <Icons.Check /> Save
              </button>
            </div>
          </div>
        )}

        {/* Controls Row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 42, paddingBottom: 8,
        }}>
          {/* Left: Time display + frame info */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 220 }}>
            <div style={{
              fontSize: 15, fontFamily: "'JetBrains Mono', monospace", color: "#e0e6ed",
              fontWeight: 600, letterSpacing: "0.01em",
            }}>
              <span>{currentTime}</span>
              <span style={{ color: "#334455", margin: "0 5px" }}>/</span>
              <span style={{ color: "#445566", fontWeight: 400 }}>{totalTimeDisplay}</span>
            </div>
            <span style={{
              fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
              color: "#334455", fontWeight: 500,
            }}>
              F{currentFrame}
            </span>
            {/* Focus indicator for viewers */}
            {focusRange && !editingFocus && (
              <button
                onClick={() => setShowFullTimeline(p => !p)}
                title={showFullTimeline ? "Show focused range" : "Show full recording"}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  padding: "2px 6px", borderRadius: 3,
                  border: `1px solid ${showFullTimeline ? "rgba(255,255,255,0.06)" : "rgba(212,168,67,0.2)"}`,
                  background: showFullTimeline ? "transparent" : "rgba(212,168,67,0.06)",
                  cursor: "pointer",
                  color: showFullTimeline ? "#556677" : "#D4A843",
                  fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                }}
              >
                <Icons.Scissors />
                {showFullTimeline ? "FULL" : "FOCUS"}
              </button>
            )}
          </div>

          {/* Center: Transport controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {/* Jump to prev kill */}
            <button
              title="Previous kill event  [ , ]"
              onClick={() => {
                const prev = [...EVENTS.filter(e => e.type === "kill").map(e => e.frame)].sort((a,b) => a-b).reverse().find(f => f < currentFrame);
                if (prev !== undefined) setCurrentFrame(prev);
              }}
              style={transportBtn(28)}
            >
              <Icons.SkipToKillBack />
            </button>

            {/* Frame step back */}
            <button
              title="Step back  [ ← ]"
              onClick={() => { setPlaying(false); setCurrentFrame(f => Math.max(0, f - 1)); }}
              style={transportBtn(28)}
            >
              <Icons.StepBack />
            </button>

            {/* Play / Pause */}
            <button onClick={() => setPlaying(p => !p)} title="Play/Pause  [ Space ]" style={{
              width: 44, height: 44, borderRadius: 12,
              background: playing ? "rgba(74,158,255,0.1)" : "linear-gradient(135deg, #4A9EFF, #3585dd)",
              border: playing ? "1px solid rgba(74,158,255,0.2)" : "none",
              color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: playing ? "none" : "0 2px 16px rgba(74,158,255,0.25)",
              transition: "all 0.2s",
              margin: "0 2px",
            }}>
              {playing ? <Icons.Pause /> : <Icons.Play />}
            </button>

            {/* Frame step forward */}
            <button
              title="Step forward  [ → ]"
              onClick={() => { setPlaying(false); setCurrentFrame(f => Math.min(TOTAL_FRAMES, f + 1)); }}
              style={transportBtn(28)}
            >
              <Icons.StepForward />
            </button>

            {/* Jump to next kill */}
            <button
              title="Next kill event  [ . ]"
              onClick={() => {
                const next = EVENTS.filter(e => e.type === "kill").map(e => e.frame).sort((a,b) => a-b).find(f => f > currentFrame);
                if (next !== undefined) setCurrentFrame(next);
              }}
              style={transportBtn(28)}
            >
              <Icons.SkipToKill />
            </button>
          </div>

          {/* Right: Speed + options */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220, justifyContent: "flex-end" }}>
            <SpeedSelector speed={speed} onSpeedChange={setSpeed} />

            {/* Focus Range button (admin only) */}
            {isAdmin && !editingFocus && (
              <button onClick={startFocusEdit} title="Edit focus range" style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 8px", borderRadius: 5, cursor: "pointer",
                background: focusRange ? "rgba(212,168,67,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${focusRange ? "rgba(212,168,67,0.15)" : "rgba(255,255,255,0.04)"}`,
                color: focusRange ? "#D4A843" : "#445566",
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
              }}>
                <Icons.Scissors /> Focus
              </button>
            )}

            <button onClick={() => setLeftPanelOpen(p => !p)} style={{
              background: leftPanelOpen ? "rgba(74,158,255,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${leftPanelOpen ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.04)"}`,
              borderRadius: 5, padding: "4px 8px", cursor: "pointer",
              color: leftPanelOpen ? "#4A9EFF" : "#445566",
              fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <Icons.Map /> Panel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
