# Player Redesign — Refactoring Steps

Tracking incremental changes from `ocap-redesign.jsx` → SolidJS codebase.

## Steps

- [x] **1. Keyboard shortcuts** — Add `←`/`→` frame stepping (1 frame, Shift for 10), `,`/`.` kill event jumping. Disable Leaflet keyboard map panning.
- [x] **2. Transport controls** — Replace 3-button layout (skip-to-start, play/pause, skip-to-end) with 5-button layout (prev kill `‹‹`, step back `‹`, play/pause, step forward `›`, next kill `››`). Tighten gap to 2px.
- [x] **3. Speed selector** — Replace `SelectDropdown` with inline horizontal button strip (`1× 2× 5× 10× 20× 60×`). Active speed highlights blue. No popup click needed.
- [ ] **4. Activity heatmap timeline** — Replace flat 6px scrub bar with 32px timeline showing event density as stacked bar columns (kills=red, hits=orange, other=gray). Bars behind playhead render bright, ahead render dim.
- [ ] **5. Playhead** — Change from floating circle on thin bar to full-height vertical line spanning heatmap + track, with a knob at the bottom.
- [ ] **6. Hover tooltip** — Show time AND nearby events contextually (☠ victim name for kills, ⚡ for hits, etc.) so you can preview what happened at a position before clicking.
- [x] **7. Bottom bar layout** — Gradient fade from transparent to opaque (no hard border). Left: time display + frame number. Center: transport. Right: speed strip + panel toggle. Remove the `SelectDropdown`s for time format, unit labels, markers from bottom bar.
- [x] **8. View Settings panel** — New gear-icon panel (replaces removed dropdowns). Contains map layer checkboxes + three radio groups: Time Format, Unit Labels, Markers. Panel closes on outside click.
