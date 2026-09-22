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
 *   4. Nothing measured the scroll containers themselves. Every probe asked
 *      whether a box clips its own content, and a box that is merely too
 *      short does not clip anything — so a page whose scroll area ended 160px
 *      above the fold, slicing every card on screen, measured perfectly
 *      clean. That is the defect the screenshots showed and the probes
 *      missed. Probe G is the measurement that was absent.
 *
 * A probe that returns [] means that one defect is absent. It does not mean
 * the page is clean, and it does not mean the probe ran. Check `viewport` and
 * `scanned` — and on A and B check `exemptInsideScroller`: a large exempt
 * count with no hits means the content is reachable only by scrolling, which
 * is probe G's question, not theirs.
 */
(() => {
  const MIN_DELTA = 2;          // px — below this is rounding, not clipping
  const WASTE = 24;             // px — unused room below a scroller worth reporting
  const DOCK_SEL = '.rs-floating-dock, .rs-mobile-dock';
  const IGNORE = /^(rs-space-label|rs-bulb|rs-floating-dock-btn|leaflet-|recharts)/;

  /** getComputedStyle returns 'auto' and '' as well as lengths. A NaN in a sum
   *  silently disqualifies the whole sum, so never let one in. */
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

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

  /** Content inside a scroll container is reachable, so it is not clipped.
   *  True per element, and the reason A and B saw nothing on a page that was
   *  visibly sliced: they exempt the content and nothing measured the
   *  container. Probe G measures the container. Both probes now count what
   *  they drop here so a zero cannot be read as a clean page. */
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

  const dockEl = () => {
    const d = document.querySelector(DOCK_SEL);
    return d && d.getBoundingClientRect().height > 0 ? d : null;
  };

  /** The lowest y a box may reach before it is under the dock or off screen.
   *  The dock only takes room away where it actually sits across the box. */
  const usableBottom = (rect) => {
    let bottom = window.innerHeight;
    const dock = dockEl();
    if (dock) {
      const d = dock.getBoundingClientRect();
      const across = Math.min(rect.right, d.right) - Math.max(rect.left, d.left);
      if (across > MIN_DELTA && d.top < bottom) bottom = d.top;
    }
    return bottom;
  };

  const stamp = () => ({
    viewport: { w: window.innerWidth, h: window.innerHeight },
    url: location.pathname + location.search,
  });

  const api = {
    /** A — content wider than its box, with no way to reach the rest of it. */
    horizontal() {
      const hits = [];
      let scanned = 0;
      let exempt = 0;
      for (const el of document.querySelectorAll('*')) {
        scanned++;
        if (ignored(el) || !visible(el)) continue;
        const s = getComputedStyle(el);
        if (['auto', 'scroll'].includes(s.overflowX)) continue;
        if (truncatesOnPurpose(s)) continue;
        if (el.scrollWidth - el.clientWidth < MIN_DELTA) continue;
        if (insideScroller(el, 'x')) { exempt++; continue; }
        hits.push(describe(el, { sw: el.scrollWidth, cw: el.clientWidth }));
      }
      return { ...stamp(), scanned, exemptInsideScroller: exempt, count: hits.length, hits };
    },

    /** B — text sliced by a box that hides the overflow. Text only: a clipped
     *  image is a crop, a clipped sentence is a defect. */
    vertical() {
      const hits = [];
      let scanned = 0;
      let exempt = 0;
      for (const el of document.querySelectorAll('*')) {
        scanned++;
        if (ignored(el) || !visible(el)) continue;
        const s = getComputedStyle(el);
        if (s.overflowY !== 'hidden' && s.overflow !== 'hidden') continue;
        if (truncatesOnPurpose(s)) continue;
        if (el.scrollHeight - el.clientHeight < MIN_DELTA) continue;
        if (!ownText(el) && !el.querySelector('p, span, h1, h2, h3, h4, li, td')) continue;
        if (insideScroller(el, 'y')) { exempt++; continue; }
        hits.push(describe(el, { sh: el.scrollHeight, ch: el.clientHeight }));
      }
      return { ...stamp(), scanned, exemptInsideScroller: exempt, count: hits.length, hits };
    },

    /** C — content underneath the fixed dock. */
    dock() {
      const dock = dockEl();
      if (!dock) {
        return { ...stamp(), error: 'dock missing or zero-height — the page had not finished rendering, or the selector is stale. This is NOT a pass.' };
      }
      const d = dock.getBoundingClientRect();
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

    /** G — a scroll area shorter than the room it has been given.
     *
     *  The measurement the other probes cannot make. A, B and C all ask
     *  whether a box clips its own content; a starved scroller does not clip
     *  anything. Its scrollHeight and clientHeight agree with each other, its
     *  children each fit, and every card inside it measures clean — while the
     *  page visibly slices text at the fold, because the scroller stops above
     *  the fold and the strip beneath it is empty.
     *
     *  That is what a `padding-bottom: 160px` on a full-height shell grid did:
     *  the rows summed to 684px on an 844px screen and every probe reported
     *  zero.
     *
     *  Only an overflowing scroller counts — a short page that ends early is
     *  holding all of its content and is not a defect. `culprits` names the
     *  ancestors reserving the empty strip, which is what you go and change;
     *  an empty culprits list means the room is lost to sizing (a fixed
     *  height, a grid track) rather than to spacing, so read `gapPx` and look
     *  at the chain yourself.
     */
    scrollAreas() {
      const hits = [];
      let scanned = 0;
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if (!['auto', 'scroll'].includes(s.overflowY)) continue;
        scanned++;
        if (ignored(el) || !visible(el)) continue;

        const hidden = el.scrollHeight - el.clientHeight;
        if (hidden < MIN_DELTA) continue;            // holds all of its content

        const r = el.getBoundingClientRect();
        const gap = Math.round(usableBottom(r) - r.bottom);
        if (gap < WASTE) continue;                   // using the room it has

        /** Walk up while the ancestor still reaches past the scroller — the
         *  empty strip has to sit inside something for that thing to be
         *  responsible for it. */
        const culprits = [];
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
          if (a.getBoundingClientRect().bottom <= r.bottom + MIN_DELTA) continue;
          const as = getComputedStyle(a);
          const reserved = num(as.paddingBottom) + num(as.borderBottomWidth) + Math.max(0, num(as.marginBottom));
          if (reserved < WASTE) continue;
          culprits.push({
            cls: cls(a) || `<${a.tagName.toLowerCase()}>`,
            reservedPx: Math.round(reserved),
            padBottom: as.paddingBottom,
            marginBottom: as.marginBottom,
          });
        }

        hits.push(describe(el, { gapPx: gap, hiddenPx: Math.round(hidden), culprits }));
      }
      return { ...stamp(), scanned, count: hits.length, hits };
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
        G_scrollAreas: this.scrollAreas(),
      };
    },
  };

  window.__uiProbes = api;
  return 'ui-probes ready — call __uiProbes.runAll()';
})();
