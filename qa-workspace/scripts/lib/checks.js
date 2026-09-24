// In-page checks used by the audit/responsive/inspect commands. These produce leads to investigate,
// not confirmed bugs — every lead must be reproduced and judged before it goes into bugs.json.

// Elements that stick out past the right edge of the viewport (causes horizontal scroll on mobile).
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    const offenders = [];
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
      if (r.right > docW + 1 && !clipped(el)) {
        // Keep only the outermost offender of each subtree.
        if (offenders.some((o) => o.el.contains(el))) continue;
        offenders.push({ el, r });
      }
    }
    const describe = (el) => {
      let d = el.tagName.toLowerCase();
      if (el.id) d += '#' + el.id;
      const cls = [...el.classList].slice(0, 3).join('.');
      if (cls) d += '.' + cls;
      return d;
    };
    return {
      hasHorizontalScroll: scrollW > docW + 1,
      documentWidth: docW,
      scrollWidth: scrollW,
      offenders: offenders.slice(0, 15).map(({ el, r }) => ({
        element: describe(el),
        right: Math.round(r.right),
        overflowPx: Math.round(r.right - docW),
        text: (el.innerText || '').trim().slice(0, 80),
      })),
    };
  });
}

async function pageInventory(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.querySelector('img[alt]')?.alt || '').trim().replace(/\s+/g, ' ');
    const describe = (el) => {
      let d = el.tagName.toLowerCase();
      if (el.id) d += '#' + el.id;
      const cls = [...el.classList].slice(0, 2).join('.');
      if (cls) d += '.' + cls;
      return d;
    };
    const isMobile = window.innerWidth < 768;
    const images = [...document.images];
    const ids = {};
    document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
    const inputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(vis);
    const labelled = (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el.getAttribute('placeholder');
    const interactive = [...document.querySelectorAll('a[href], button, [role=button], summary')].filter(vis);
    return {
      title: document.title,
      lang: document.documentElement.lang || null,
      metaDescription: document.querySelector('meta[name=description]')?.content || null,
      headings: [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).slice(0, 60)
        .map((h) => `${h.tagName} ${h.innerText.trim().replace(/\s+/g, ' ').slice(0, 90)}`),
      h1Count: [...document.querySelectorAll('h1')].filter(vis).length,
      sections: [...document.querySelectorAll('[id^="shopify-section"], main > section, main > div')].slice(0, 60)
        .map((s) => ({ id: s.id || null, classes: [...s.classList].slice(0, 3).join(' '), heading: s.querySelector('h1,h2,h3')?.innerText.trim().slice(0, 80) || null })),
      forms: [...document.forms].filter(vis).map((f) => ({ action: f.getAttribute('action'), fields: f.elements.length, id: f.id || null })),
      brokenImages: images.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc.slice(0, 200)).slice(0, 30),
      imagesMissingAlt: images.filter((i) => vis(i) && !i.hasAttribute('alt')).map((i) => (i.currentSrc || i.src).slice(0, 200)).slice(0, 30),
      unnamedControls: interactive.filter((el) => !name(el)).map(describe).slice(0, 30),
      unlabelledInputs: inputs.filter((el) => !labelled(el)).map(describe).slice(0, 30),
      duplicateIds: Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id} (x${n})`).slice(0, 30),
      smallTapTargets: isMobile ? interactive.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width < 24 || r.height < 24;
      }).map((el) => `${describe(el)} "${name(el).slice(0, 40)}"`).slice(0, 30) : [],
      links: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href))]
        .filter((h) => /^https?:/.test(h)).slice(0, 400),
      buttons: interactive.filter((el) => el.tagName !== 'A').map((el) => name(el).slice(0, 60)).filter(Boolean).slice(0, 80),
    };
  });
}

// Checks same-site links respond without 4xx/5xx. Off-site links are listed but not requested.
async function checkLinks(page, links, { limit = 80 } = {}) {
  const origin = new URL(page.url()).origin;
  const seen = new Set();
  const internal = [];
  for (const href of links) {
    const u = new URL(href);
    if (u.origin !== origin) continue;
    u.hash = '';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    internal.push(u.href);
  }
  const results = [];
  for (const href of internal.slice(0, limit)) {
    try {
      const res = await page.request.get(href, { maxRedirects: 5, timeout: 20000 });
      if (res.status() >= 400) results.push({ href, status: res.status() });
    } catch (e) {
      results.push({ href, status: 'ERROR', error: e.message.split('\n')[0] });
    }
  }
  return { checked: Math.min(internal.length, limit), totalInternal: internal.length, broken: results };
}

const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'gap',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'opacity', 'object-fit',
  'justify-content', 'align-items', 'flex-direction', 'grid-template-columns', 'z-index', 'overflow',
];

// Computed styles + size for comparing an element against Figma's values.
async function inspectElements(page, selector, { max = 5 } = {}) {
  const loc = page.locator(selector);
  const count = await loc.count();
  const out = [];
  for (let i = 0; i < Math.min(count, max); i++) {
    const el = loc.nth(i);
    const box = await el.boundingBox();
    const info = await el.evaluate((node, props) => {
      const s = getComputedStyle(node);
      const styles = {};
      for (const p of props) styles[p] = s.getPropertyValue(p);
      return {
        tag: node.tagName.toLowerCase(),
        text: (node.innerText || node.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        attributes: Object.fromEntries([...node.attributes].filter((a) => /^(id|class|href|src|alt|aria-|role|type|name|disabled|data-)/.test(a.name)).slice(0, 12).map((a) => [a.name, a.value.slice(0, 120)])),
        styles,
      };
    }, STYLE_PROPS);
    out.push({ index: i, box: box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 10) / 10])), ...info });
  }
  return { selector, matches: count, elements: out };
}

module.exports = { horizontalOverflow, pageInventory, checkLinks, inspectElements };
