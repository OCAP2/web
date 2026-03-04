# UI Customization

OCAP2-Web supports white-labeling through server-side configuration. You can customize branding, colors, and the overall look of the UI without modifying any frontend code.

## Generate a Theme with AI

The fastest way to get a custom theme is to use an AI assistant. Copy the prompt below, fill in the description at the end, and paste the output into your config.

<details>
<summary><strong>Copy this prompt into ChatGPT, Claude, or any AI assistant</strong></summary>

````
I need you to generate a CSS color theme for OCAP2-Web, a dark-themed military
simulation replay viewer. The output must be a JSON object I can paste directly
into the "cssOverrides" field of my setting.json.

## Constraints

- This is a DARK UI. All background colors must be dark. Text must be light.
- The UI renders on top of map tiles, so panels use semi-transparent backgrounds.
- Accent colors are used for buttons, links, active states, and highlights.
  They must have enough contrast against dark surfaces.
- "--text-on-accent" is text rendered ON TOP of the accent color background
  (e.g. a button label). It must contrast against "--accent-primary".
- The text scale goes from bright (--text-primary) to nearly invisible
  (--text-dimmest). Each step should be noticeably dimmer than the previous.
- "--bg-panel" and "--bg-panel-header" MUST use rgba() to preserve transparency.
  Use the same RGB as --bg-dark with alpha 0.88 and 0.6 respectively.
- "--bg-interactive" and "--bg-interactive-hover" should be very subtle tints
  (4-12% opacity) — they overlay on surfaces for hover effects.
- "--bg-modal-header" should be a saturated, semi-transparent version of the
  accent color (around 0.85-0.9 alpha).

## CSS Variables to Generate

Return ALL of these keys with appropriate values:

```
--accent-primary          Main accent (buttons, links, active indicators)
--accent-primary-dark     Darker accent (hover/pressed states)
--text-on-accent          Text on accent backgrounds (usually dark or white)
--accent-success          Success/positive state color
--accent-success-dark     Darker success variant
--accent-warning          Warning/caution color
--accent-focus            Focus range accent (handles, toolbar, toggle)
--text-primary            Brightest text (headings, body)
--text-secondary          Slightly dimmer text
--text-muted              Muted labels, placeholders
--text-dim                Subtle text, timestamps
--text-dimmer             Very subtle text
--text-dimmest            Barely visible, decorative
--bg-dark                 Page background (solid, darkest color)
--bg-panel                Panel overlay (rgba, ~0.88 alpha)
--bg-panel-header         Panel header (rgba, ~0.6 alpha)
--bg-surface              Cards, inputs, list items (solid)
--bg-surface-hover        Hover state for surfaces (solid, slightly lighter)
--bg-interactive          Clickable element rest state (rgba, ~0.04-0.06 alpha)
--bg-interactive-hover    Clickable element hover (rgba, ~0.08-0.12 alpha)
--bg-modal-header         Modal header (rgba, accent-tinted, ~0.85 alpha)
```

## Default Theme (for reference)

This is the built-in blue theme. Your output should differ from this:

```json
{
  "--accent-primary": "#4A9EFF",
  "--accent-primary-dark": "#3585dd",
  "--text-on-accent": "#fff",
  "--accent-success": "#2DD4A0",
  "--accent-success-dark": "#1a9a74",
  "--accent-warning": "#FFB84A",
  "--accent-focus": "#D4A843",
  "--text-primary": "#e5ebf1",
  "--text-secondary": "#cfd9e4",
  "--text-muted": "#96a7b8",
  "--text-dim": "#6b7e90",
  "--text-dimmer": "#5b6f82",
  "--text-dimmest": "#4c6174",
  "--bg-dark": "#0a0f14",
  "--bg-panel": "rgba(10, 15, 20, 0.88)",
  "--bg-panel-header": "rgba(10, 15, 20, 0.6)",
  "--bg-surface": "#151e2b",
  "--bg-surface-hover": "#1a2332",
  "--bg-interactive": "rgba(255, 255, 255, 0.04)",
  "--bg-interactive-hover": "rgba(255, 255, 255, 0.08)",
  "--bg-modal-header": "rgba(155, 0, 0, 0.9)"
}
```

The full variable reference is at:
https://github.com/OCAP2/web/blob/main/ui/src/styles/variables.css

## Output Format

Return TWO code blocks:

1. A JSON object for use in `setting.json` under `"cssOverrides"`:
```json
{
  "--accent-primary": "#...",
  ...
}
```

2. A single-line environment variable for Docker deployments:
```bash
OCAP_CUSTOMIZE_CSSOVERRIDES='{"--accent-primary":"#...","--bg-dark":"#..."}'
```

No explanation needed, just the two code blocks.

## My Theme Request

[DESCRIBE YOUR THEME HERE — e.g. "desert sand and burnt orange", "arctic white
and ice blue", "crimson and black like a PMC", "NATO olive drab", etc.]
````

</details>

## How It Works

1. Add a `customize` block to `setting.json` (or use environment variables for Docker)
2. Set `"enabled": true`
3. The frontend fetches your customization on page load and applies CSS overrides to the document root
4. All UI components inherit the new colors automatically — no rebuild needed
5. To revert, set `"enabled": false` and refresh the page

## Quick Start

Add this to your `setting.json`:

```json
{
  "customize": {
    "enabled": true,
    "headerTitle": "YOUR GROUP NAME",
    "headerSubtitle": "After Action Reviews",
    "cssOverrides": {
      "--accent-primary": "#fcb00d",
      "--bg-dark": "#1a2a1a"
    }
  }
}
```

Or via Docker environment variables:

```bash
OCAP_CUSTOMIZE_ENABLED=true
OCAP_CUSTOMIZE_HEADERTITLE="Your Group Name"
OCAP_CUSTOMIZE_CSSOVERRIDES='{"--accent-primary":"#fcb00d","--bg-dark":"#1a2a1a"}'
```

You only need to override the variables you want to change — everything else keeps the defaults.

## Example Themes

### Military Green

```json
{
  "customize": {
    "enabled": true,
    "headerTitle": "Profiteers PMC",
    "headerSubtitle": "After Action Reviews",
    "cssOverrides": {
      "--accent-primary": "#fcb00d",
      "--accent-primary-dark": "#e6a600",
      "--text-on-accent": "#1a2a1a",
      "--accent-success": "#8ab23a",
      "--accent-success-dark": "#6b8e23",
      "--accent-warning": "#fcb00d",
      "--text-primary": "#f4f3e8",
      "--text-secondary": "#e0dfd0",
      "--text-muted": "#b2b27d",
      "--text-dim": "#8a8a60",
      "--text-dimmer": "#6b7e55",
      "--text-dimmest": "#556b45",
      "--bg-dark": "#1a2a1a",
      "--bg-panel": "rgba(26, 42, 26, 0.88)",
      "--bg-panel-header": "rgba(26, 42, 26, 0.6)",
      "--bg-surface": "#2e3b2e",
      "--bg-surface-hover": "#3a4a3a",
      "--bg-interactive": "rgba(255, 255, 255, 0.04)",
      "--bg-interactive-hover": "rgba(255, 255, 255, 0.08)",
      "--bg-modal-header": "rgba(107, 142, 35, 0.9)",
      "--accent-focus": "#B8962E"
    }
  }
}
```

### Industrial

```json
{
  "customize": {
    "enabled": true,
    "headerTitle": "IRONWORKS MIL-SIM",
    "headerSubtitle": "Combat Analysis Division",
    "cssOverrides": {
      "--accent-primary": "#D46A2E",
      "--accent-primary-dark": "#B85520",
      "--text-on-accent": "#1a1a1a",
      "--accent-success": "#5A9E6F",
      "--accent-success-dark": "#3D7A50",
      "--accent-warning": "#E8A838",
      "--text-primary": "#D4D0C8",
      "--text-secondary": "#B8B4AC",
      "--text-muted": "#8A8680",
      "--text-dim": "#6B6862",
      "--text-dimmer": "#55524D",
      "--text-dimmest": "#403E3A",
      "--bg-dark": "#121214",
      "--bg-panel": "rgba(18, 18, 20, 0.88)",
      "--bg-panel-header": "rgba(18, 18, 20, 0.6)",
      "--bg-surface": "#1E1E22",
      "--bg-surface-hover": "#2A2A2F",
      "--bg-interactive": "rgba(212, 106, 46, 0.06)",
      "--bg-interactive-hover": "rgba(212, 106, 46, 0.12)",
      "--bg-modal-header": "rgba(180, 80, 30, 0.85)",
      "--accent-focus": "#C44040"
    }
  }
}
```

---

## Reference

### Configuration Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `false` | Enable the customization system |
| `headerTitle` | string | `""` | Title shown in the header bar. If empty, the UI defaults to "OCAP". |
| `headerSubtitle` | string | `""` | Subtitle below the title. If empty, the UI defaults to "Operation Capture and Playback · N recordings". |
| `websiteLogo` | string | — | URL or path to a logo image |
| `websiteURL` | string | — | Clicking the logo opens this URL |
| `websiteLogoSize` | string | `"32px"` | CSS height for the logo |
| `cssOverrides` | object | `{}` | CSS custom property overrides (see below) |

### Environment Variables

Every field can also be set via environment variables with the `OCAP_` prefix. Environment variables take priority over `setting.json`.

| Setting | Environment Variable |
|---|---|
| `customize.enabled` | `OCAP_CUSTOMIZE_ENABLED` |
| `customize.headerTitle` | `OCAP_CUSTOMIZE_HEADERTITLE` |
| `customize.headerSubtitle` | `OCAP_CUSTOMIZE_HEADERSUBTITLE` |
| `customize.websiteLogo` | `OCAP_CUSTOMIZE_WEBSITELOGO` |
| `customize.websiteURL` | `OCAP_CUSTOMIZE_WEBSITEURL` |
| `customize.websiteLogoSize` | `OCAP_CUSTOMIZE_WEBSITELOGOSIZE` |
| `customize.cssOverrides` | `OCAP_CUSTOMIZE_CSSOVERRIDES` (JSON string) |

### CSS Variables — Accent Colors

| Variable | Default | Used For |
|---|---|---|
| `--accent-primary` | `#4A9EFF` | Buttons, links, active states, focus rings |
| `--accent-primary-dark` | `#3585dd` | Hover/pressed states for primary elements |
| `--text-on-accent` | `#fff` | Text rendered on top of accent-colored backgrounds |
| `--accent-success` | `#2DD4A0` | Success indicators |
| `--accent-success-dark` | `#1a9a74` | Hover states for success elements |
| `--accent-warning` | `#FFB84A` | Warning indicators |
| `--accent-danger` | `#FF4A4A` | Error states, delete actions |
| `--accent-danger-dark` | `#CC3333` | Hover states for danger elements |
| `--accent-focus` | `#D4A843` | Focus range UI (handles, toolbar, toggle) |

### CSS Variables — Text Colors

| Variable | Default | Used For |
|---|---|---|
| `--text-primary` | `#e5ebf1` | Main body text, headings |
| `--text-secondary` | `#cfd9e4` | Secondary labels, descriptions |
| `--text-muted` | `#96a7b8` | Placeholders, less important info |
| `--text-dim` | `#6b7e90` | Disabled text, timestamps |
| `--text-dimmer` | `#5b6f82` | Very subtle text |
| `--text-dimmest` | `#4c6174` | Barely visible text, decorative |

### CSS Variables — Backgrounds

| Variable | Default | Used For |
|---|---|---|
| `--bg-dark` | `#0a0f14` | Page background |
| `--bg-panel` | 88% of `--bg-dark` | Side panels, overlays |
| `--bg-panel-header` | 60% of `--bg-dark` | Panel header bars |
| `--bg-surface` | `#151e2b` | Cards, list items, inputs |
| `--bg-surface-hover` | `#1a2332` | Hover state for surfaces |
| `--bg-interactive` | `rgba(255,255,255,0.04)` | Clickable elements at rest |
| `--bg-interactive-hover` | `rgba(255,255,255,0.08)` | Clickable elements on hover |
| `--bg-modal-header` | `rgba(155,0,0,0.9)` | Modal/dialog header background |

> **Note:** `--bg-panel` and `--bg-panel-header` default to computed values based on `--bg-dark`. When overriding them, use `rgba()` with the same RGB as your `--bg-dark` to preserve the transparency effect.

For the complete list of all available CSS custom properties, see [`variables.css`](https://github.com/OCAP2/web/blob/main/ui/src/styles/variables.css).
