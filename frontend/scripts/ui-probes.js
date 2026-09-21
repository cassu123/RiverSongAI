/**
 * ui-probes.js — layout defect probes for the running app.
 *
 * Paste into a DevTools console, or evaluate with whatever drives the browser,
 * then call `__uiProbes.runAll()`.
 *
 * These replace a set of hand-written one-liners whose numbers could not be
 * trusted. Three things went wrong with those, and each is fixed here:
 *
 *   1. They did not record the viewport, so a run that never actually resized
 *      looked identical to one that did. Every result now carries the viewport
 *      it was measured at, and runAll() refuses to report without one.
 *   2. They counted deliberate truncation as a defect. An element with
 *      text-overflow: ellipsis or -webkit-line-clamp is doing its job; it is
 *      not clipped content. Same for anything inside a scroll container — the
 *      content is reachable.
 *   3. They counted sub-pixel rounding. A line-height that computes to 20.4px
 *      in a 20px box is not a sliced glyph. The threshold is 2px.
 *
 * A probe that returns [] means the defect is absent. It does not mean the
 * probe ran: check the `viewport` and `scanned` fields.
 */
(() => {
  const MIN_DELTA = 2;          // px — below this is rounding, not clipping
  const IGNORE = /^(rs-space-label|rs-header-voice-orb-wrap|rs-bulb|rs-floating-dock-btn|leaflet-|recharts)/;

  const cls = (el) =>
    typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || '');

  const ignored = (el) => cls(el).split(/\s+/).some((c) => IGNORE.test(c));

  const visible = (el) => {
    if (el.checkVisibility) return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !!el.offsetParent;
  };

  /** Text this element owns directly, not the whole subtree's. */
  const ownText = (el) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();

  /** Deliberate truncation is not a defect.
   *  getComputedStyle does not expose lineClamp under every name in every
   *  engine, and an absent property reads as undefined — which is not 'none',
   *  which made an earlier version of this treat EVERY element as
   *  deliberately truncated and report zero defects everywhere. Normalise
   *  before comparing. */
  const truncatesOnPurpose = (s) => {
    const clamp = s.webkitLineClamp || s.lineClamp || 'none';
    return s.textOverflow === 'ellipsis' || (clamp !== 'none' && clamp !== '');
  };

  /** Content inside a scroll container is reachable, so it is not clipped. */
  const insideScroller = (el, axis) => {
    const prop = axis === 'x' ? 'overflowX' : 'overflowY';
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(p)[prop])) return true;
    }
    return false;
  };

  const describe = (el, extra) => ({
    cls: cls(el) || `<${el.tagName.toLowerCase()}>`,
    text: (el.textContent || '').trim().slice(0, 60),
    ...extra,
  });

  const stamp = () => ({
    viewport: { w: window.innerWidth, h: window.innerHeight },
    url: location.pathname + location.search,
  });

  const api = {
    /** A — content wider than its box, with no way to reach the rest of it. */
    horizontal() {
      const hits = [];
      let scanned = 0;
      for (const el of document.querySelectorAll('*')) {
        scanned++;
        if (ignored(el) || !visible(el)) continue;
        const s = getComputedStyle(el);
        if (['auto', 'scroll'].includes(s.overflowX)) continue;
        if (truncatesOnPurpose(s)) continue;
        if (el.scrollWidth - el.clientWidth < MIN_DELTA) continue;
        if (insideScroller(el, 'x')) continue;
        hits.push(describe(el, { sw: el.scrollWidth, cw: el.clientWidth }));
      }
      return { ...stamp(), scanned, count: hits.length, hits };
    },

    /** B — text sliced by a box that hides the overflow. Text only: a clipped
     *  image is a crop, a clipped sentence is a defect. */
    vertical() {
      const hits = [];
      let scanned = 0;
      for (const el of document.querySelectorAll('*')) {
        scanned++;
        if (ignored(el) || !visible(el)) continue;
        const s = getComputedStyle(el);
        if (s.overflowY !== 'hidden' && s.overflow !== 'hidden') continue;
        if (truncatesOnPurpose(s)) continue;
        if (el.scrollHeight - el.clientHeight < MIN_DELTA) continue;
        if (!ownText(el) && !el.querySelector('p, span, h1, h2, h3, h4, li, td')) continue;
        if (insideScroller(el, 'y')) continue;
        hits.push(describe(el, { sh: el.scrollHeight, ch: el.clientHeight }));
      }
      return { ...stamp(), scanned, count: hits.length, hits };
    },

    /** C — content underneath the fixed dock. */
    dock() {
      const dock = document.querySelector('.rs-floating-dock, .rs-mobile-dock');
      if (!dock) {
        return { ...stamp(), error: 'dock not found — the page had not finished rendering, or the selector is stale. This is NOT a pass.' };
      }
      const d = dock.getBoundingClientRect();
      if (d.height === 0) return { ...stamp(), error: 'dock has zero height — not rendered yet. This is NOT a pass.' };
      const hits = [];
      let scanned = 0;
      for (const el of document.querySelectorAll('.rs-content *')) {
        scanned++;
        if (ignored(el) || dock.contains(el) || !visible(el)) continue;
        if (!ownText(el)) continue;
        const r = el.getBoundingClientRect();
        const overlap = Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top);
        const across = Math.min(r.right, d.right) - Math.max(r.left, d.left);
        if (overlap < MIN_DELTA || across < MIN_DELTA) continue;
        hits.push(describe(el, { overlapPx: Math.round(overlap) }));
      }
      return { ...stamp(), scanned, count: hits.length, hits };
    },

    /** D — rendered text below the 11px floor, icons excluded. */
    tinyType() {
      const FLOOR = 11;
      const hits = [];
      for (const el of document.querySelectorAll('*')) {
        if (ignored(el) || !visible(el) || !ownText(el)) continue;
        if (cls(el).includes('material-symbols')) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px >= FLOOR - 0.01) continue;
        hits.push(describe(el, { px: +px.toFixed(2) }));
      }
      return { ...stamp(), count: hits.length, hits };
    },

    /** E — the page itself scrolling sideways. */
    sideways() {
      const over = document.documentElement.scrollWidth - window.innerWidth;
      return { ...stamp(), overflowPx: over > MIN_DELTA ? over : 0 };
    },

    /** F — nested card frames. Inventory, not a defect. */
    nesting() {
      const sel = '.rs-card, .rs-panel, .rs-field';
      const rows = [];
      for (const el of document.querySelectorAll(sel)) {
        let depth = 0;
        for (let p = el.parentElement; p; p = p.parentElement) if (p.matches?.(sel)) depth++;
        if (depth > 0) rows.push(describe(el, { depth }));
      }
      return { ...stamp(), count: rows.length, maxDepth: rows.reduce((m, r) => Math.max(m, r.depth), 0), hits: rows };
    },

    runAll() {
      return {
        ...stamp(),
        A_horizontal: this.horizontal(),
        B_vertical: this.vertical(),
        C_dock: this.dock(),
        D_tinyType: this.tinyType(),
        E_sideways: this.sideways(),
        F_nesting: this.nesting(),
      };
    },
  };

  window.__uiProbes = api;
  return 'ui-probes ready — call __uiProbes.runAll()';
})();
