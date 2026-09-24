// Browser helpers: launching, viewports, Shopify password/preview handling, logging, marking.
const { chromium, firefox, webkit, devices } = require('playwright');
const { loadCredentials } = require('./common');

const VIEWPORTS = {
  'desktop-1440': { width: 1440, height: 900, type: 'desktop' },
  'desktop-1280': { width: 1280, height: 800, type: 'desktop' },
  'tablet-768': { width: 768, height: 1024, type: 'tablet' },
  'mobile-430': { width: 430, height: 932, type: 'mobile' },
  'mobile-390': { width: 390, height: 844, type: 'mobile' },
  'mobile-375': { width: 375, height: 812, type: 'mobile' },
};

function viewportFor(key) {
  if (VIEWPORTS[key]) return { key, ...VIEWPORTS[key] };
  const m = /^(\d+)x(\d+)$/.exec(key || '');
  if (m) {
    const width = +m[1];
    return { key, width, height: +m[2], type: width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop' };
  }
  throw new Error(`Unknown viewport "${key}". Use one of: ${Object.keys(VIEWPORTS).join(', ')} or WIDTHxHEIGHT`);
}

// "chrome" = the installed Google Chrome (default). webkit/firefox need: npx playwright install webkit firefox
async function launch(browserName = 'chrome', { headed = false } = {}) {
  const opts = { headless: !headed };
  if (browserName === 'chrome') return chromium.launch({ ...opts, channel: 'chrome' });
  if (browserName === 'chromium') return chromium.launch(opts);
  const type = { webkit, safari: webkit, firefox }[browserName];
  if (!type) throw new Error(`Unknown browser "${browserName}". Use chrome, webkit or firefox.`);
  try {
    return await type.launch(opts);
  } catch (e) {
    throw new Error(`${browserName} is not installed for Playwright. Run once: npx playwright install ${type.name()}\n${e.message.split('\n')[0]}`);
  }
}

async function newPage(browser, viewportKey, { browserName = 'chrome', scale = 1 } = {}) {
  const vp = viewportFor(viewportKey);
  const ctxOpts = { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: scale };
  if (vp.type !== 'desktop') {
    const device = vp.type === 'tablet' ? devices['iPad (gen 7)'] : devices['iPhone 14'];
    ctxOpts.userAgent = device.userAgent;
    ctxOpts.hasTouch = true;
    if (browserName !== 'firefox') ctxOpts.isMobile = true;
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const log = { console: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.console.push({ type: m.type(), text: m.text().slice(0, 500) });
  });
  page.on('pageerror', (e) => log.pageErrors.push(String(e.message).slice(0, 500)));
  page.on('requestfailed', (r) => log.failedRequests.push({ url: r.url().slice(0, 300), error: r.failure()?.errorText }));
  page.on('response', (r) => {
    if (r.status() >= 400) log.httpErrors.push({ url: r.url().slice(0, 300), status: r.status() });
  });
  return { context, page, log, viewport: vp };
}

async function settleNetwork(page, timeout = 8000) {
  try { await page.waitForLoadState('networkidle', { timeout }); } catch { /* long-polling pages never go idle */ }
}

// Opens a URL, getting past the Shopify storefront password page if credentials were provided.
async function open(page, url, { hidePreviewBar = true } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settleNetwork(page);
  const onPasswordPage = /\/password(\?|$|\/)/.test(new URL(page.url()).pathname + '?') ||
    (await page.locator('form[action*="/password"] input[type="password"]').count()) > 0;
  if (onPasswordPage) {
    const { storePassword } = loadCredentials();
    if (!storePassword) {
      throw new Error('Store is password protected. Add "storePassword" to input/credentials.local.json.');
    }
    const field = page.locator('form[action*="/password"] input[type="password"]').first();
    if (!(await field.isVisible())) {
      // Some themes hide the password form behind an "Enter using password" toggle.
      const toggle = page.locator('a, button, summary').filter({ hasText: /password/i }).first();
      if (await toggle.count()) await toggle.click();
    }
    await field.fill(storePassword);
    await Promise.all([page.waitForLoadState('domcontentloaded'), field.press('Enter')]);
    await settleNetwork(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settleNetwork(page);
  }
  if (hidePreviewBar) await hideShopifyChrome(page);
}

// The Shopify preview/admin bar is not part of the storefront design; hide it so it isn't reported as a bug.
async function hideShopifyChrome(page) {
  await page.addStyleTag({
    content: '#preview-bar-iframe,#PBarNextFrameWrapper,#PBarNextFrame,#admin-bar-iframe,iframe[src*="preview_bar"],iframe[id*="preview-bar"]{display:none!important}',
  }).catch(() => {});
}

// Scroll the whole page so lazy-loaded images/sections render before a full-page screenshot.
async function loadLazyContent(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await settleNetwork(page, 5000);
  await page.waitForTimeout(400);
}

// Draws red boxes + labels around targets. Targets: { selector, index?, box:{x,y,width,height} (page coords), label }
// fullPage=false scrolls the first target to the middle of the screen and uses fixed overlays (works for sticky elements).
async function drawMarks(page, targets, { fullPage = false } = {}) {
  const first = targets.find((t) => t.selector);
  if (first && !fullPage) {
    await page.locator(first.selector).nth(first.index || 0).scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(({ selector, index }) => {
      const el = document.querySelectorAll(selector)[index || 0];
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, { selector: toCss(first.selector), index: first.index || 0 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const resolved = [];
  for (const t of targets) {
    let box = t.box ? { ...t.box, pageCoords: true } : null;
    if (t.selector) {
      const b = await page.locator(t.selector).nth(t.index || 0).boundingBox().catch(() => null);
      if (!b) throw new Error(`Cannot mark "${t.selector}": element not found or not visible`);
      box = b; // viewport coordinates
    }
    resolved.push({ ...box, label: t.label || '' });
  }
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await page.evaluate(({ marks, fullPage, scroll }) => {
    const root = document.createElement('div');
    root.id = '__qa_marks__';
    document.body.appendChild(root);
    const pad = 4;
    for (const m of marks) {
      // Convert everything to the coordinate space of the overlay type.
      let x = m.x, y = m.y;
      if (m.pageCoords && !fullPage) { x -= scroll.x; y -= scroll.y; }
      if (!m.pageCoords && fullPage) { x += scroll.x; y += scroll.y; }
      const pos = fullPage ? 'absolute' : 'fixed';
      // Keep the box inside the visible width so all four edges show even for overflowing elements.
      const vw = document.documentElement.clientWidth;
      const left = Math.max(2, x - pad);
      const right = Math.min(vw - 2, x + m.width + pad);
      const box = document.createElement('div');
      box.style.cssText = `position:${pos};left:${left}px;top:${y - pad}px;width:${Math.max(12, right - left)}px;height:${m.height + pad * 2}px;border:3px solid #E5202E;border-radius:4px;box-shadow:0 0 0 2px rgba(255,255,255,.85);pointer-events:none;z-index:2147483647;box-sizing:border-box;`;
      root.appendChild(box);
      if (m.label) {
        const tag = document.createElement('div');
        tag.textContent = m.label;
        const above = y - pad - 30 > (fullPage ? 0 : 4);
        tag.style.cssText = `position:${pos};left:${Math.max(4, x - pad)}px;top:${above ? y - pad - 30 : y + m.height + pad + 4}px;max-width:360px;background:#E5202E;color:#fff;font:600 13px/1.3 -apple-system,Helvetica,Arial,sans-serif;padding:5px 8px;border-radius:4px;pointer-events:none;z-index:2147483647;white-space:normal;`;
        root.appendChild(tag);
      }
    }
  }, { marks: resolved, fullPage, scroll });
  return resolved;
}

async function clearMarks(page) {
  await page.evaluate(() => document.getElementById('__qa_marks__')?.remove()).catch(() => {});
}

// Playwright selectors like "text=Add to cart" aren't CSS; only used for the centering hint.
function toCss(selector) {
  return /^(text=|role=|xpath=|internal:)|>>|:has-text\(/.test(selector) ? 'body' : selector;
}

// Takes the evidence pair: <name>.png (clean) and <name>-marked.png (with boxes).
async function captureMarkedPair(page, targets, cleanPath, markedPath, { fullPage = false } = {}) {
  await drawMarks(page, targets, { fullPage });
  await clearMarks(page);
  // Marks were drawn once to scroll into position; take the clean shot at the same position.
  await page.screenshot({ path: cleanPath, fullPage });
  await drawMarks(page, targets, { fullPage });
  await page.screenshot({ path: markedPath, fullPage });
  await clearMarks(page);
}

module.exports = {
  VIEWPORTS, viewportFor, launch, newPage, open, settleNetwork, hideShopifyChrome,
  loadLazyContent, drawMarks, clearMarks, captureMarkedPair,
};
