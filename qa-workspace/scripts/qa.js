#!/usr/bin/env node
// Shopify QA workspace command line. Run `node scripts/qa.js help` for the command list.
const fs = require('fs');
const path = require('path');
const C = require('./lib/common');
const B = require('./lib/browser');
const checks = require('./lib/checks');

const HELP = `
Shopify QA workspace commands (run from the qa-workspace folder):

  doctor                                Check the browser, Word and folder setup
  new-run "<Project>" [--date YYYY-MM-DD]  Start a new QA run (becomes the active run)
  use-run <run-id>                      Switch the active run
  audit <url> [--viewport v] [--no-links]  Explore a page: structure, broken links/images, a11y leads, errors
  responsive <url> [--viewports a,b]    Screenshots + overflow check at every viewport
  inspect <url> "<selector>" [--viewport v]  Computed styles/size of an element (compare to Figma)
  steps <scenario.json> [--headed]      Run a scripted scenario in the real browser
  mark-image <in.png> <out.png> --box x,y,w,h[,label] [--box ...]  Mark areas on an existing image
  compare <website.png> <figma.png> <out.png> [--title t] [--note n]  Website vs Figma side by side
  validate                              Check bugs.json/scenarios.json for missing fields or evidence
  status                                Print the final QA status summary
  report                                Generate the Word report into reports/latest/
  figma-package                         Build Figma-ready bug cards (fallback when Figma can't be edited)

Common options: --run <run-id>  --browser chrome|webkit|firefox  --viewport ${Object.keys(B.VIEWPORTS).join('|')}|WxH
`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next === undefined || next.startsWith('--') ? true : (i++, next);
      if (key === 'box') (flags.box = flags.box || []).push(val);
      else flags[key] = val;
    } else pos.push(a);
  }
  return { pos, flags };
}

const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const pageSlug = (url) => {
  const u = new URL(url);
  return C.slugify(u.pathname === '/' ? 'home' : u.pathname);
};

const commands = {
  help: async () => print(HELP),

  doctor: async () => {
    const out = { workspace: C.ROOT };
    try {
      const b = await B.launch('chrome');
      out.chrome = `OK (${b.version()})`;
      await b.close();
    } catch (e) { out.chrome = `NOT AVAILABLE: ${e.message.split('\n')[0]}`; }
    for (const name of ['webkit', 'firefox']) {
      try { const b = await B.launch(name); out[name] = 'OK'; await b.close(); } catch { out[name] = `not installed (optional: npx playwright install ${name})`; }
    }
    try { require('docx'); out.wordReports = 'OK'; } catch { out.wordReports = 'MISSING: run npm install'; }
    out.credentialsFile = fs.existsSync(path.join(C.DIRS.input, 'credentials.local.json')) ? 'present' : 'not created (only needed for password-protected stores/logins)';
    out.activeRun = fs.existsSync(C.CURRENT_FILE) ? fs.readFileSync(C.CURRENT_FILE, 'utf8').trim() : 'none';
    print(out);
  },

  'new-run': async ({ pos, flags }) => {
    const project = pos[0];
    if (!project) throw new Error('Usage: new-run "<Project Name>"');
    const date = flags.date || C.today();
    let id = `${date}-${C.slugify(project)}`;
    for (let n = 2; fs.existsSync(path.join(C.DIRS.results, id)); n++) id = `${date}-${C.slugify(project)}-${n}`;
    const dir = C.mkdirp(path.join(C.DIRS.results, id));
    C.mkdirp(path.join(dir, 'logs'));
    C.mkdirp(path.join(dir, 'scenarios'));
    C.writeJson(path.join(dir, 'run.json'), {
      project, date, tester: flags.tester || '', scopeTitle: '',
      previewUrl: flags.url || '', scope: [], outOfScope: [],
      figma: { url: '', fileKey: '', frames: [], qaPage: { name: 'QA - Bug Reports', status: 'not started', url: '' } },
      requirement: { id: '', title: '', source: '', summary: '', acceptanceCriteria: [] },
      sourceCode: { provided: false, path: '' },
      environment: { browsers: ['Google Chrome (desktop + mobile emulation)'], viewports: Object.entries(B.VIEWPORTS).map(([k, v]) => `${k} (${v.width}x${v.height})`), os: `macOS ${require('os').release()}`, notes: '' },
      summary: '', verdict: '', regressionConcerns: [], notes: '',
    });
    C.writeJson(path.join(dir, 'scenarios.json'), []);
    C.writeJson(path.join(dir, 'bugs.json'), []);
    C.writeJson(path.join(dir, 'observations.json'), []);
    fs.writeFileSync(path.join(dir, 'test-plan.md'), `# Test plan — ${project}\n\n_Written by Claude before testing starts (Phase 1)._\n`);
    fs.writeFileSync(C.CURRENT_FILE, id);
    print({ created: C.rel(dir), activeRun: id });
  },

  'use-run': async ({ pos }) => {
    const r = C.resolveRun(pos[0]);
    fs.writeFileSync(C.CURRENT_FILE, r.id);
    print({ activeRun: r.id });
  },

  audit: async ({ pos, flags }) => {
    const url = pos[0];
    if (!url) throw new Error('Usage: audit <url>');
    const run = C.resolveRun(flags.run);
    const vp = flags.viewport || 'desktop-1440';
    const browserName = flags.browser || 'chrome';
    const browser = await B.launch(browserName);
    const { page, log } = await B.newPage(browser, vp, { browserName });
    await B.open(page, url);
    await B.loadLazyContent(page);
    const inv = await checks.pageInventory(page);
    const overflow = await checks.horizontalOverflow(page);
    const links = flags['no-links'] ? { skipped: true } : await checks.checkLinks(page, inv.links);
    C.mkdirp(run.screenshotsDir);
    const shot = path.join(run.screenshotsDir, `audit-${pageSlug(url)}-${vp}-full.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const result = {
      url, finalUrl: page.url(), viewport: vp, browser: browserName, ranAt: new Date().toISOString(),
      fullPageScreenshot: C.rel(shot), ...inv, linkCount: inv.links.length, links: undefined,
      linkCheck: links, overflow, consoleErrors: log.console.filter((c) => c.type === 'error'),
      pageErrors: log.pageErrors, httpErrors: log.httpErrors, failedRequests: log.failedRequests,
    };
    await browser.close();
    const out = path.join(run.logsDir, `audit-${pageSlug(url)}-${vp}.json`);
    C.writeJson(out, result);
    print({ saved: C.rel(out), note: 'These are LEADS to investigate, not confirmed bugs.', ...result });
  },

  responsive: async ({ pos, flags }) => {
    const url = pos[0];
    if (!url) throw new Error('Usage: responsive <url>');
    const run = C.resolveRun(flags.run);
    const vps = flags.viewports ? String(flags.viewports).split(',') : Object.keys(B.VIEWPORTS);
    const browserName = flags.browser || 'chrome';
    const dir = C.mkdirp(path.join(run.screenshotsDir, 'responsive'));
    const browser = await B.launch(browserName);
    const results = [];
    for (const vp of vps) {
      const { context, page, log } = await B.newPage(browser, vp, { browserName });
      try {
        await B.open(page, url);
        const top = path.join(dir, `${pageSlug(url)}-${vp}.png`);
        await page.screenshot({ path: top });
        await B.loadLazyContent(page);
        const full = path.join(dir, `${pageSlug(url)}-${vp}-full.png`);
        await page.screenshot({ path: full, fullPage: true });
        const overflow = await checks.horizontalOverflow(page);
        results.push({ viewport: vp, aboveTheFold: C.rel(top), fullPage: C.rel(full), overflow,
          consoleErrors: log.console.filter((c) => c.type === 'error').length, pageErrors: log.pageErrors });
      } catch (e) {
        results.push({ viewport: vp, error: e.message.split('\n')[0] });
      }
      await context.close();
    }
    await browser.close();
    const out = path.join(run.logsDir, `responsive-${pageSlug(url)}.json`);
    C.writeJson(out, { url, browser: browserName, ranAt: new Date().toISOString(), results });
    print({ saved: C.rel(out), note: 'Open the screenshots and review each viewport visually; overflow data are leads only.',
      results: results.map((r) => ({ viewport: r.viewport, error: r.error, horizontalScroll: r.overflow?.hasHorizontalScroll, offenders: r.overflow?.offenders?.slice(0, 5), screenshot: r.aboveTheFold, fullPage: r.fullPage })) });
  },

  inspect: async ({ pos, flags }) => {
    const [url, selector] = pos;
    if (!url || !selector) throw new Error('Usage: inspect <url> "<selector>"');
    const browserName = flags.browser || 'chrome';
    const browser = await B.launch(browserName);
    const { page } = await B.newPage(browser, flags.viewport || 'desktop-1440', { browserName });
    await B.open(page, url);
    const res = await checks.inspectElements(page, selector, { max: +(flags.max || 5) });
    await browser.close();
    print(res);
  },

  steps: async ({ pos, flags }) => {
    if (!pos[0]) throw new Error('Usage: steps <scenario.json>');
    const run = C.resolveRun(flags.run);
    const { runSteps, loadSpec } = require('./lib/steps');
    const spec = loadSpec(C.abs(pos[0]));
    const res = await runSteps(spec, run, { headed: !!flags.headed });
    print(res);
  },

  'mark-image': async ({ pos, flags }) => {
    const [inFile, outFile] = pos;
    if (!inFile || !outFile || !flags.box) throw new Error('Usage: mark-image <in.png> <out.png> --box x,y,w,h[,label]');
    const boxes = flags.box.map((b) => {
      const [x, y, w, hgt, ...label] = String(b).split(',');
      return { x: +x, y: +y, width: +w, height: +hgt, label: label.join(',') };
    });
    const { markImage } = require('./lib/images');
    await markImage(C.abs(inFile), C.abs(outFile), boxes);
    print({ saved: C.rel(C.abs(outFile)) });
  },

  compare: async ({ pos, flags }) => {
    const [site, figma, outFile] = pos;
    if (!site || !figma || !outFile) throw new Error('Usage: compare <website.png> <figma.png> <out.png>');
    const { compareImages } = require('./lib/images');
    await compareImages(C.abs(site), C.abs(figma), C.abs(outFile), { title: flags.title === true ? '' : flags.title, note: flags.note === true ? '' : flags.note });
    print({ saved: C.rel(C.abs(outFile)) });
  },

  validate: async ({ flags }) => {
    const run = C.resolveRun(flags.run);
    const data = C.loadRunData(run);
    const problems = [];
    const warn = [];
    const ids = new Set();
    const required = ['id', 'title', 'severity', 'severityReason', 'priority', 'category', 'page', 'url', 'component', 'viewport', 'browser', 'expected', 'actual', 'steps', 'frequency'];
    for (const b of data.bugs) {
      const tag = b.id || '(bug without id)';
      if (ids.has(b.id)) problems.push(`${tag}: duplicate bug ID`);
      ids.add(b.id);
      if (!/^BUG-\d{3,}$/.test(b.id || '')) problems.push(`${tag}: ID must look like BUG-001`);
      for (const f of required) if (b[f] === undefined || b[f] === '' || (Array.isArray(b[f]) && !b[f].length)) problems.push(`${tag}: missing "${f}"`);
      if (b.severity && !C.SEVERITIES.includes(b.severity)) problems.push(`${tag}: severity must be one of ${C.SEVERITIES.join(', ')}`);
      if (b.category && !C.CATEGORIES.includes(b.category)) problems.push(`${tag}: category must be one of ${C.CATEGORIES.join(', ')}`);
      const ev = b.evidence || {};
      const files = [ev.screenshot, ev.marked, ev.comparison, ev.figma, ...(ev.extra || []).map((e) => e.file || e)].filter(Boolean);
      for (const f of files) if (!fs.existsSync(C.abs(f))) problems.push(`${tag}: evidence file not found: ${f}`);
      if (!files.length && !ev.log) problems.push(`${tag}: no evidence recorded`);
      if (['UI', 'Responsive'].includes(b.category) && !ev.marked) problems.push(`${tag}: ${b.category} bug needs a marked screenshot`);
      if (b.possibleCause && !data.run.sourceCode?.provided) warn.push(`${tag}: possibleCause set but no source code was provided — make sure it is not a guess`);
    }
    for (const s of data.scenarios) {
      if (!C.SCENARIO_STATUSES.includes(s.status)) problems.push(`${s.id || 'scenario'}: status must be one of ${C.SCENARIO_STATUSES.join(', ')}`);
      for (const bid of s.bugIds || []) if (!ids.has(bid)) problems.push(`${s.id}: refers to unknown ${bid}`);
      if (s.status === 'FAIL' && !(s.bugIds || []).length) warn.push(`${s.id}: FAIL without a linked bug`);
    }
    for (const o of data.observations) if (!C.OBSERVATION_TYPES.includes(o.type)) problems.push(`${o.id || 'observation'}: type must be one of ${C.OBSERVATION_TYPES.join(', ')}`);
    if (!data.run.previewUrl) warn.push('run.json: previewUrl is empty');
    print({ run: run.id, bugs: data.bugs.length, scenarios: data.scenarios.length, problems, warnings: warn, ok: !problems.length });
    if (problems.length) process.exitCode = 1;
  },

  status: async ({ flags }) => {
    const run = C.resolveRun(flags.run);
    const data = C.loadRunData(run);
    const s = C.summarize(data);
    print(`FINAL QA STATUS — ${data.run.project || run.id}
Result: ${C.verdict(data)}

Total scenarios: ${s.scenarios.total}
Passed: ${s.scenarios.passed}
Failed: ${s.scenarios.failed}
Blocked: ${s.scenarios.blocked}
Not Verified: ${s.scenarios.notVerified}

Critical: ${s.severity.CRITICAL}
High: ${s.severity.HIGH}
Medium: ${s.severity.MEDIUM}
Low: ${s.severity.LOW}

UI Bugs: ${s.category.UI}
Functional Bugs: ${s.category.Functional}
Responsive Bugs: ${s.category.Responsive}
Accessibility Bugs: ${s.category.Accessibility}

Release Blocking Issues:
${s.releaseBlocking.map((b) => `- ${b.id} [${b.severity}] ${b.title}`).join('\n') || '- None'}

Regression Concerns:
${(data.run.regressionConcerns || []).map((r) => `- ${r}`).join('\n') || '- None noted'}`);
  },

  report: async ({ flags }) => {
    const run = C.resolveRun(flags.run);
    await commands.validate({ flags });
    if (process.exitCode) console.log('\nNote: validation problems above will show up in the report. Fix them and re-run if possible.');
    const { buildReport } = require('./lib/report');
    const out = await buildReport(run, C.loadRunData(run));
    print({ report: C.rel(out) });
  },

  'figma-package': async ({ flags }) => {
    const run = C.resolveRun(flags.run);
    const { buildFigmaPackage } = require('./lib/figma-package');
    print(await buildFigmaPackage(run, C.loadRunData(run)));
  },
};

(async () => {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) { console.error(`Unknown command "${cmd}".`); print(HELP); process.exit(1); }
  try {
    await fn(parseArgs(rest));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
})();
