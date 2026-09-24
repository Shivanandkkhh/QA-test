// Runs a test scenario described as JSON steps in a real browser and records every result.
// See QA_INSTRUCTIONS.md ("Scenario step files") for the full list of actions.
const path = require('path');
const fs = require('fs');
const { launch, newPage, open, viewportFor, settleNetwork, captureMarkedPair, loadLazyContent, hideShopifyChrome } = require('./browser');
const { horizontalOverflow, inspectElements } = require('./checks');
const { mkdirp, rel, writeJson } = require('./common');

async function runSteps(spec, run, { headed = false } = {}) {
  const browserName = spec.browser || 'chrome';
  const browser = await launch(browserName, { headed });
  let { context, page, log, viewport } = await newPage(browser, spec.viewport || 'desktop-1440', { browserName });
  const results = [];
  const shots = [];
  mkdirp(run.screenshotsDir);
  mkdirp(run.markedDir);
  const shotPath = (name) => path.join(run.screenshotsDir, `${name}.png`);
  let failed = false;

  const actions = {
    goto: async (s) => { await open(page, s.url || spec.url); return page.url(); },
    click: async (s) => { await page.locator(s.selector).nth(s.index || 0).click({ timeout: s.timeout || 10000, force: !!s.force }); await settle(s); },
    tap: async (s) => { await page.locator(s.selector).nth(s.index || 0).tap({ timeout: s.timeout || 10000 }); await settle(s); },
    hover: async (s) => { await page.locator(s.selector).nth(s.index || 0).hover(); await page.waitForTimeout(s.waitMs ?? 400); },
    fill: async (s) => { await page.locator(s.selector).nth(s.index || 0).fill(String(s.value ?? '')); },
    type: async (s) => { await page.locator(s.selector).nth(s.index || 0).pressSequentially(String(s.value ?? ''), { delay: 40 }); },
    select: async (s) => { await page.locator(s.selector).nth(s.index || 0).selectOption(s.value); await settle(s); },
    check: async (s) => { await page.locator(s.selector).nth(s.index || 0).check(); await settle(s); },
    press: async (s) => { await page.keyboard.press(s.key); await settle(s); },
    clickRepeat: async (s) => {
      const el = page.locator(s.selector).nth(s.index || 0);
      for (let i = 0; i < (s.times || 5); i++) {
        await el.click({ timeout: 5000, noWaitAfter: true }).catch((e) => { if (i === 0) throw e; });
        await page.waitForTimeout(s.intervalMs ?? 50);
      }
      await settle(s);
    },
    scrollTo: async (s) => {
      if (s.selector) await page.locator(s.selector).nth(s.index || 0).scrollIntoViewIfNeeded();
      else await page.evaluate((y) => window.scrollTo(0, y), s.y || 0);
      await page.waitForTimeout(400);
    },
    wait: async (s) => page.waitForTimeout(s.ms || 1000),
    waitFor: async (s) => page.locator(s.selector).nth(s.index || 0).waitFor({ state: s.state || 'visible', timeout: s.timeout || 15000 }),
    back: async (s) => { await page.goBack({ waitUntil: 'domcontentloaded' }); await settle(s); return page.url(); },
    forward: async (s) => { await page.goForward({ waitUntil: 'domcontentloaded' }); await settle(s); return page.url(); },
    reload: async (s) => { await page.reload({ waitUntil: 'domcontentloaded' }); await settle(s); await hideShopifyChrome(page); },
    setViewport: async (s) => {
      const vp = viewportFor(s.viewport);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      viewport = vp;
      await page.waitForTimeout(600);
    },
    newContext: async (s) => {
      // Fresh browser session (empty cart/cookies), optionally at another viewport.
      await context.close();
      ({ context, page, log, viewport } = await newPage(browser, s.viewport || viewport.key, { browserName }));
    },
    screenshot: async (s) => {
      if (s.fullPage) await loadLazyContent(page);
      const file = shotPath(s.name);
      if (s.selector) await page.locator(s.selector).nth(s.index || 0).screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: !!s.fullPage });
      shots.push(rel(file));
      return rel(file);
    },
    mark: async (s) => {
      const clean = shotPath(s.name);
      const marked = path.join(run.markedDir, `${s.name}-marked.png`);
      await captureMarkedPair(page, s.targets, clean, marked, { fullPage: !!s.fullPage });
      shots.push(rel(clean), rel(marked));
      return { screenshot: rel(clean), marked: rel(marked) };
    },
    text: async (s) => (await page.locator(s.selector).nth(s.index || 0).innerText()).trim(),
    count: async (s) => page.locator(s.selector).count(),
    inspect: async (s) => inspectElements(page, s.selector, { max: s.max || 3 }),
    overflow: async () => horizontalOverflow(page),
    eval: async (s) => page.evaluate(new Function(s.script)),
    cart: async () => page.evaluate(async () => {
      const r = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      const c = await r.json();
      return {
        item_count: c.item_count,
        total_price: c.total_price,
        currency: c.currency,
        items: c.items.map((i) => ({ title: i.title, variant_id: i.variant_id, quantity: i.quantity, price: i.price, final_line_price: i.final_line_price, properties: i.properties, selling_plan: i.selling_plan_allocation?.selling_plan?.name || null })),
        cart_level_discounts: c.cart_level_discount_applications,
      };
    }),
    expectVisible: async (s) => {
      const visible = await page.locator(s.selector).nth(s.index || 0).isVisible();
      assert(visible === (s.visible ?? true), `Expected "${s.selector}" to be ${s.visible === false ? 'hidden' : 'visible'}`);
      return visible;
    },
    expectText: async (s) => {
      const t = (await page.locator(s.selector).nth(s.index || 0).innerText({ timeout: s.timeout || 10000 })).trim();
      if (s.equals !== undefined) assert(t === s.equals, `Expected text "${s.equals}", got "${t}"`);
      if (s.contains !== undefined) assert(t.toLowerCase().includes(String(s.contains).toLowerCase()), `Expected text to contain "${s.contains}", got "${t.slice(0, 200)}"`);
      if (s.notContains !== undefined) assert(!t.toLowerCase().includes(String(s.notContains).toLowerCase()), `Expected text NOT to contain "${s.notContains}"`);
      return t.slice(0, 300);
    },
    expectCount: async (s) => {
      const n = await page.locator(s.selector).count();
      assert(n === s.count || (s.min !== undefined && n >= s.min), `Expected ${s.count ?? '>= ' + s.min} of "${s.selector}", found ${n}`);
      return n;
    },
    expectUrl: async (s) => {
      const u = page.url();
      assert(u.includes(s.contains), `Expected URL to contain "${s.contains}", got ${u}`);
      return u;
    },
    expectNoOverflow: async () => {
      const o = await horizontalOverflow(page);
      assert(!o.hasHorizontalScroll, `Horizontal overflow: page is ${o.scrollWidth}px wide in a ${o.documentWidth}px viewport`);
      return o;
    },
  };

  async function settle(s) {
    await page.waitForTimeout(s.waitMs ?? 700);
    await settleNetwork(page, 4000);
  }

  for (const [i, step] of (spec.steps || []).entries()) {
    const entry = { step: i + 1, action: step.action, note: step.note, selector: step.selector };
    if (failed && !step.always) { entry.status = 'SKIPPED'; results.push(entry); continue; }
    const fn = actions[step.action];
    const t0 = Date.now();
    try {
      if (!fn) throw new Error(`Unknown action "${step.action}"`);
      const value = await fn(step);
      entry.status = 'OK';
      if (value !== undefined) entry.value = value;
    } catch (e) {
      entry.status = e.isAssertion ? 'ASSERT FAILED' : 'ERROR';
      entry.error = e.message.split('\n')[0];
      if (!step.continueOnFail) failed = true;
      const file = shotPath(`${slug(spec.name)}-step${i + 1}-failure`);
      await page.screenshot({ path: file }).then(() => { entry.failureScreenshot = rel(file); shots.push(rel(file)); }).catch(() => {});
    }
    entry.ms = Date.now() - t0;
    results.push(entry);
  }

  const summary = {
    name: spec.name,
    scenarioId: spec.scenarioId || null,
    url: page.url(),
    viewport: viewport.key,
    browser: browserName,
    ranAt: new Date().toISOString(),
    outcome: results.some((r) => r.status === 'ASSERT FAILED') ? 'ASSERTION FAILED'
      : results.some((r) => r.status === 'ERROR') ? 'ERROR' : 'ALL STEPS OK',
    steps: results,
    screenshots: shots,
    consoleErrors: log.console.filter((c) => c.type === 'error'),
    pageErrors: log.pageErrors,
    httpErrors: log.httpErrors,
    failedRequests: log.failedRequests,
  };
  await browser.close();
  const out = path.join(run.logsDir, `${slug(spec.name)}.result.json`);
  writeJson(out, summary);
  summary.resultFile = rel(out);
  return summary;
}

function assert(ok, message) {
  if (!ok) {
    const e = new Error(message);
    e.isAssertion = true;
    throw e;
  }
}

function slug(s) {
  return String(s || 'scenario').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function loadSpec(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { runSteps, loadSpec };
