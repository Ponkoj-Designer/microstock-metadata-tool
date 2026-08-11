---
name: Cyber-Refined Professional
colors:
  surface: '#111417'
  surface-dim: '#111417'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#191c1f'
  surface-container: '#1d2023'
  surface-container-high: '#282a2e'
  surface-container-highest: '#323539'
  on-surface: '#e1e2e7'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e1e2e7'
  inverse-on-surface: '#2e3134'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#f4aeff'
  on-secondary: '#55006a'
  secondary-container: '#db50ff'
  on-secondary-container: '#4b005d'
  tertiary: '#fff3f2'
  on-tertiary: '#680008'
  tertiary-container: '#ffcec9'
  on-tertiary-container: '#c10018'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#fdd6ff'
  secondary-fixed-dim: '#f4aeff'
  on-secondary-fixed: '#340042'
  on-secondary-fixed-variant: '#790095'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb3ac'
  on-tertiary-fixed: '#410003'
  on-tertiary-fixed-variant: '#930010'
  background: '#111417'
  on-background: '#e1e2e7'
  surface-variant: '#323539'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar_width: 375px
  topbar_height: 68px
  gutter: 24px
  margin_desktop: 40px
  container_max: 1440px
  stack_sm: 8px
  stack_md: 16px
  stack_lg: 32px
---

## Brand & Style

The design system is engineered for a high-performance, AI-driven environment. The aesthetic combines **Corporate Modern** structure with **Glassmorphism** and **High-Tech** accents. It targets creative professionals and data-heavy workflows where precision meets inspiration. 

The visual narrative is "Synthetic Intelligence": dark, expansive canvases punctuated by bioluminescent-inspired accents (Cyan and Purple). The emotional response should be one of sophisticated power, reliability, and cutting-edge capability. Interfaces use deep layering, subtle light leaks, and razor-thin borders to create a sense of depth and technical refinement.

## Colors

The palette is anchored in a "Deep Space" hierarchy to maximize contrast for the AI-generated metadata. 

- **Primary (Cyan):** Reserved for core interactions, active states, and "success" metaphors. It should appear as a light source.
- **Secondary (Purple):** Used for creative highlights, AI-processing indicators, and subtle gradients.
- **Danger (Red):** High-utility color for destructive actions or specific platform-wide alerts.
- **Neutrals:** A tiered dark system. The main background is a void black, while surfaces (cards) use a charcoal tint to separate content from the canvas. 

Apply `0.1` opacity Cyan glows behind primary CTAs to simulate a high-tech "powered-on" state.

## Typography

This design system utilizes **Inter** for its neutral, highly legible character across the UI. For technical data and labels, **Geist** is introduced to provide a "developer-tool" precision.

- **Display & Headlines:** Use tight letter spacing to maintain a compact, premium feel. 
- **Body Text:** Always use the muted blue-gray (`#8B949E`) for long-form metadata descriptions to reduce eye strain, reserving pure White for titles and interactive text.
- **Labels:** Use uppercase for `label-sm` when used in headers or metadata keys to evoke a technical dashboard aesthetic.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model designed for professional desktop immersion.

- **Sidebar:** A fixed 375px left-hand column serves as the primary navigation and configuration hub.
- **Topbar:** A fixed 68px header provides global actions and breadcrumbs.
- **Central Workspace:** A fluid area that expands to a max-width of 1440px. Content within this space should use a 12-column grid with 24px gutters.
- **Internal Spacing:** Use a base-8 rhythm. Elements within a card should be separated by 16px (stack_md), while major sections use 32px (stack_lg).

## Elevation & Depth

Depth is achieved through **Tonal Layering** and **Luminescent Outlines** rather than traditional drop shadows.

- **Level 0 (Background):** Pure `#05070A`.
- **Level 1 (Sidebar/Secondary Panels):** `#0D1117`.
- **Level 2 (Cards/Main Surfaces):** `#161B22`. Use a 1px solid border of `#30363D`.
- **Level 3 (Popovers/Modals):** `#1C2128`. These should include a subtle `20px` background blur for elements behind them.

**Glow Effects:** Primary buttons and active indicators should utilize a `0px 0px 12px 0px` outer glow using the Primary Cyan at 30% opacity. Hero elements may feature a top-edge gradient border (Cyan to Purple) at 1px thickness.

## Shapes

The system balances utility and modern organic forms. 

- **Containers:** Large workspace cards and the main upload area use a generous **24px** radius to soften the high-tech aesthetic.
- **Controls:** Inputs, buttons, and dropdowns use a **10px** radius for a professional, "tool-like" appearance.
- **Selectors:** Platform tags and status chips must use the **Pill** (fully rounded) shape to distinguish them from actionable buttons.

## Components

### Buttons & Inputs
- **Primary Button:** Solid Cyan background, black text. On hover, apply a Cyan glow.
- **Secondary Button:** Ghost style with a `#30363D` border. On hover, the border transitions to Purple.
- **Input Fields:** Darker than the surface color (`#0D1117`), 1px border. Focus state triggers a Cyan border and a subtle internal glow.

### Platform Selectors
- **Pill Tags:** Use a horizontal list of pill-shaped buttons. Active platform (e.g., Adobe Stock, Getty) gets a gradient fill (Cyan to Purple) with white text.

### Toggles & Sliders
- **Toggle Switch:** Rectangular track with 100% rounded corners. The thumb should be white. Active state track is Cyan.
- **Range Slider:** A thin 2px track. The thumb is a 16px Cyan circle with a concentrated glow effect.

### Cards
- **Metadata Cards:** Use the `Level 2` surface color. Ensure metadata keys are `label-sm` and values are `body-md`.
- **Hero Upload Zone:** Use a dashed gradient border (Cyan/Purple) with a translucent background blur.

### Navigation
- **Sidebar Items:** Use clean line icons. Active items feature a vertical 3px Cyan "light-bar" on the far left edge and a subtle Cyan tint to the icon.