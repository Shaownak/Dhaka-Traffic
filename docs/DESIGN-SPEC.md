# Seven Kilometres an Hour

A visual data story about traffic congestion in Dhaka. Scrollytelling, one page, no
navigation. Built for a general audience, not for researchers.

`reference/prototype.html` is a working single-file prototype with every section built
and visually approved. **It is the spec.** When something is ambiguous, open the
prototype and match it. Do not redesign anything that already works there.

---

## Stack

- Vite, vanilla TypeScript, no UI framework. The page has no routing, no shared app
  state beyond a few module-level variables, and no server. A framework would add
  weight and buy nothing.
- D3 v7 for the 2D charts. Import submodules (`d3-scale`, `d3-shape`, `d3-selection`)
  rather than the `d3` meta-package so the bundle stays small.
- Three.js for the street simulation, imported as an ES module and code-split so it
  loads only when that section is near the viewport.
- Fonts: Fraunces (700, 900) and Karla (400, 600), latin subset only, self-hosted as
  woff2 with `font-display: swap`. Do not add a Google Fonts link.
- Plain CSS with custom properties. No Tailwind, no CSS-in-JS.

## Target structure

```
src/
  main.ts                 entry, section observers, boot order
  data/
    traffic.ts            ALL numbers live here and nowhere else
  sections/
    jam.ts                cover: 2D canvas traffic field
    race.ts               car vs pedestrian, SVG
    clock.ts              radial 24-hour clock, SVG, hover
    map.ts                corridor map, SVG, hover
    street/
      index.ts            section wiring, controls, lazy Three import
      scene.ts            geometry, lights, sky-by-hour
      traffic-model.ts    car-following simulation, no Three imports
    cost.ts               year grid + corridor picker
    night.ts              closing ring
  styles/
    tokens.css            colours, type scale, spacing
    base.css
    sections.css
public/fonts/
reference/prototype.html
```

`traffic-model.ts` must not import Three. It takes lane configuration and returns
positions. That separation is what makes the model testable and is the one piece of
this codebase worth unit tests.

## Design tokens — do not invent new ones

```
--cream    #F6EEE0     page ground
--ink      #2A1712     body text on cream
--plum     #3E1220     cover ground
--crimson  #C42348     cost section ground, rickshaw red
--pink     #E8548C
--marigold #F2A310     accents, active controls
--teal     #0D6A6C
--indigo   #1E1B52     clock section ground
```

Congestion ramp, used identically in every chart and in the 3D scene. Never
substitute a different scale:

```
4 km/h  #B4172F
6       #E0662A
9       #F2A310
14      #7FBF4A
25      #3FA88A
```

Display type is Fraunces 900 with `letter-spacing: -0.028em` and `line-height: 0.9`.
Body is Karla 400. The paper grain overlay (fixed, 5.5% opacity, SVG turbulence) sits
above everything at `z-index: 60` and must survive the port — it is what stops the
saturated colour looking like a web template.

## Rules

**Data.** Every figure currently in the prototype is a placeholder. Keep them all in
`data/traffic.ts` with a comment marking them unverified, and keep the footer line
saying so. Do not present any number as a finding until a real source replaces it, and
do not invent new numbers to fill a chart.

**The simulation is a model, not an animation.** Vehicles choose speed from the gap
ahead: `want = min(vmax, (gap - minGap) / headway)`, clamped by acceleration and
braking limits, plus a small random brake tap that seeds stop-start waves. The queues
are emergent. If a refactor makes the traffic look smoother, it is broken.

**Performance budget.** 60fps on a mid-range laptop and 30fps on a mid-range phone.
Vehicles render through `InstancedMesh`, not one mesh each. Both canvases stop their
animation loop when off-screen via IntersectionObserver — keep that. Initial JS
excluding Three under 150KB gzipped.

**Motion.** Everything respects `prefers-reduced-motion`. Under that setting the 3D
scene renders a single static frame and charts appear without transitions. Do not add
fade-and-slide-up entrance animations to sections; the only motion is content motion.

**Accessibility.** Charts carry `role="img"` and a real `aria-label`. All controls are
buttons or inputs with visible focus rings. The hour slider is a native
`input[type=range]` and stays that way. Colour never carries meaning alone; the map
and clock both label their values.

**Mobile.** The cover scrim switches from horizontal to vertical below 860px because
the headline sits over the traffic. The 3D canvas drops to `k = 0.62` vehicle scale.
Check both, they break easily.

## Commands

```
npm run dev
npm run build
npm run preview
npm run typecheck
```

## Out of scope

No CMS, no analytics, no cookie banner, no share buttons, no dark mode toggle. The
page has its own light and dark sections by design. If a feature is not in the
prototype, ask before building it.
