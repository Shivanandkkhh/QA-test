// Builds the Word QA report from the run's structured data (run.json, scenarios.json, bugs.json, observations.json).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  ImageRun, AlignmentType, BorderStyle, Footer, PageNumber, PageBreak,
} = require('docx');
const { abs, imageSize, summarize, verdict, SEVERITIES, CATEGORIES, DIRS, mkdirp, slugify, today } = require('./common');

const FONT = 'Calibri';
const COLORS = { text: '1F2937', muted: '6B7280', line: 'D1D5DB', head: 'F3F4F6', accent: '1D4ED8' };
const SEV_COLOR = { CRITICAL: '991B1B', HIGH: 'C2410C', MEDIUM: 'B45309', LOW: '2563EB' };
const MAX_IMG_W = 600; // px, fits A4/Letter with 1" margins
const MAX_IMG_H = 760;

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 100 },
  alignment: opts.align,
  children: [].concat(text).map((t) => (t instanceof TextRun ? t : new TextRun({ text: String(t ?? ''), bold: opts.bold, color: opts.color, size: opts.size, italics: opts.italics, font: FONT }))),
});
const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, ...o });
const h = (text, level = 1) => new Paragraph({
  heading: [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level],
  spacing: { before: level === 1 ? 320 : 220, after: 120 },
  children: [new TextRun({ text, font: FONT })],
});
const bullet = (text) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [].concat(text).map((t) => (t instanceof TextRun ? t : run(t))) });
const numbered = (items) => items.map((t, i) => p(`${i + 1}. ${t}`, { after: 60 }));

const border = { style: BorderStyle.SINGLE, size: 4, color: COLORS.line };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cell(content, { head = false, width, fill, color, bold } = {}) {
  const paras = [].concat(content).map((c) => (c instanceof Paragraph ? c
    : new Paragraph({ spacing: { after: 40 }, children: [run(c, { bold: head || bold, color: color || COLORS.text, size: 19 })] })));
  return new TableCell({
    children: paras,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: head || fill ? { type: ShadingType.CLEAR, color: 'auto', fill: fill || COLORS.head } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(headers, rows, widths) {
  const tr = [];
  if (headers) tr.push(new TableRow({ tableHeader: true, children: headers.map((x, i) => cell(x, { head: true, width: widths?.[i] })) }));
  for (const r of rows) tr.push(new TableRow({ children: r.map((x, i) => (x instanceof TableCell ? x : cell(x, { width: widths?.[i] }))) }));
  return new Table({ rows: tr, width: { size: 100, type: WidthType.PERCENTAGE }, borders });
}

// Two-column "Field | Value" table.
function kv(pairs) {
  return table(null, pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [cell(k, { head: true, width: 28 }), cell(String(v), { width: 72 })]), [28, 72]);
}

function sevText(sev) {
  return run(sev || '-', { bold: true, color: SEV_COLOR[sev] || COLORS.text });
}

function image(file, caption, { maxW = MAX_IMG_W } = {}) {
  const full = abs(file);
  if (!fs.existsSync(full)) return [p(`[Missing evidence file: ${file}]`, { color: '991B1B', italics: true })];
  const { width, height, type } = imageSize(full);
  // Narrow (mobile) screenshots are shown smaller so they stay readable without taking whole pages.
  const limitW = width <= 500 ? Math.min(maxW, 320) : maxW;
  const scale = Math.min(1, limitW / width, MAX_IMG_H / height);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 40 },
      children: [new ImageRun({ type, data: fs.readFileSync(full), transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })] }),
    p(caption, { align: AlignmentType.CENTER, color: COLORS.muted, size: 17, italics: true, after: 160 }),
  ];
}

function list(items, empty = 'None.') {
  const arr = (items || []).filter(Boolean);
  return arr.length ? arr.map((x) => bullet(x)) : [p(empty, { color: COLORS.muted, italics: true })];
}

function bugSection(b) {
  const ev = b.evidence || {};
  const out = [
    new Paragraph({ children: [new PageBreak()] }),
    h(`${b.id} — ${b.title}`, 2),
    kv([
      ['Bug ID', b.id],
      ['Title', b.title],
      ['Severity', `${b.severity}${b.severityReason ? ' — ' + b.severityReason : ''}`],
      ['Priority', b.priority],
      ['Category', b.category],
      ['Page', b.page],
      ['URL', b.url],
      ['Component / Section', b.component],
      ['Environment', b.environment],
      ['Viewport', b.viewport],
      ['Browser', b.browser],
      ['Requirement', b.requirement],
      ['Frequency', b.frequency],
      ['Release blocking', b.releaseBlocking ? 'YES' : 'No'],
      ['Design reference', b.designReference],
    ]),
    h('Description', 3), p(b.description || '-'),
    h('Steps to Reproduce', 3), ...numbered(b.steps || []),
    h('Expected Result', 3), p(b.expected || '-'),
    h('Actual Result', 3), p(b.actual || '-'),
    h('Evidence', 3),
  ];
  if (ev.screenshot) out.push(...image(ev.screenshot, `${b.id} — screenshot (${b.viewport || ''})`));
  if (ev.marked) out.push(...image(ev.marked, `${b.id} — marked screenshot: affected area highlighted in red`));
  for (const extra of ev.extra || []) out.push(...image(extra.file || extra, extra.caption || `${b.id} — additional evidence`));
  if (!ev.screenshot && !ev.marked && !(ev.extra || []).length) out.push(p(ev.note || 'No screenshot evidence (see Notes).', { italics: true, color: COLORS.muted }));
  if (ev.log) out.push(p([run('Log / data evidence: ', { bold: true }), run(ev.log)]));
  if (ev.comparison || ev.figma) {
    out.push(h('Figma Reference', 3));
    if (b.designReference) out.push(p(b.designReference, { color: COLORS.accent }));
    if (ev.comparison) out.push(...image(ev.comparison, `${b.id} — website (actual) vs Figma (expected)`));
    else out.push(...image(ev.figma, `${b.id} — Figma design (expected)`));
  }
  if (b.possibleCause) { out.push(h('Possible Technical Cause', 3), p(b.possibleCause)); }
  if (b.notes) { out.push(h('Notes', 3), p(b.notes)); }
  return out;
}

async function buildReport(runInfo, data) {
  const { run: r, bugs, scenarios, observations } = data;
  const s = summarize(data);
  const project = r.project || runInfo.id;
  const date = r.date || today();
  const v = verdict(data);
  const verdictColor = /NOT READY/.test(v) ? '991B1B' : /RISK/.test(v) ? 'C2410C' : /MINOR/.test(v) ? 'B45309' : '15803D';
  const sortedBugs = [...bugs].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id));
  const byCat = (c) => sortedBugs.filter((b) => b.category === c).map((b) => [run(`${b.id} `, { bold: true }), sevText(b.severity), run(` — ${b.title}${b.viewport ? ` (${b.viewport})` : ''}`)]);
  const areas = [...new Set(scenarios.map((x) => x.area || 'General'))];
  const env = r.environment || {};
  const req = r.requirement || {};
  const figma = r.figma || {};
  const previewOnly = r.mode === 'preview';
  const qaType = previewOnly ? 'Preview-only QA (no design provided)' : 'Design QA (website vs Figma)';

  const children = [
    // ---- Cover ----
    p('', { after: 1200 }),
    p('QA TEST REPORT', { bold: true, size: 26, color: COLORS.accent, after: 120 }),
    p(project, { bold: true, size: 52, after: 200 }),
    p(`${r.scopeTitle || qaType}  ·  ${date}`, { size: 24, color: COLORS.muted, after: 600 }),
    table(null, [[cell([new Paragraph({ children: [run('Overall result:  ', { bold: true, size: 24 }), run(v, { bold: true, size: 24, color: verdictColor })] })], { fill: 'F9FAFB' })]]),
    p('', { after: 200 }),
    table(['Scenarios', 'Passed', 'Failed', 'Blocked', 'Not verified', 'Confirmed bugs'],
      [[s.scenarios.total, s.scenarios.passed, s.scenarios.failed, s.scenarios.blocked, s.scenarios.notVerified, bugs.length].map(String)]),
    p('', { after: 120 }),
    table(SEVERITIES, [SEVERITIES.map((x) => cell([new Paragraph({ children: [run(String(s.severity[x]), { bold: true, size: 26, color: SEV_COLOR[x] })] })]))]),
    p('', { after: 400 }),
    kv([['Prepared by', r.tester || 'QA'], ['QA type', qaType], ['Run ID', runInfo.id], ['Tested URL', r.previewUrl]]),

    // ---- 1. Summary ----
    new Paragraph({ children: [new PageBreak()] }),
    h('1. Executive Summary'),
    p([run('Result: ', { bold: true }), run(v, { bold: true, color: verdictColor })]),
    p(r.summary || `${s.scenarios.total} scenarios were executed; ${bugs.length} confirmed bug(s) were found (${SEVERITIES.map((x) => `${s.severity[x]} ${x.toLowerCase()}`).join(', ')}).`),
    h('Release-blocking issues', 3),
    ...list(s.releaseBlocking.map((b) => [run(`${b.id} `, { bold: true }), sevText(b.severity), run(` — ${b.title}`)]), 'No release-blocking issues confirmed.'),

    // ---- 2. Project information ----
    h('2. Project Information'),
    kv([
      ['Project', project],
      ['Test date', date],
      ['Tester', r.tester],
      ['QA type', qaType],
      ['Tested URL (preview/staging)', r.previewUrl],
      ['Pages in scope', (r.scope || []).join(', ')],
      ['Figma file', previewOnly ? 'Not provided (preview-only QA)' : figma.url],
      ['Figma frames compared', (figma.frames || []).map((f) => (typeof f === 'string' ? f : `${f.name}${f.url ? ' — ' + f.url : ''}`)).join('\n')],
      ['Figma QA page', figma.qaPage && figma.qaPage.status !== 'not started' ? `${figma.qaPage.name || 'QA - Bug Reports'}: ${figma.qaPage.status}${figma.qaPage.url ? ' — ' + figma.qaPage.url : ''}` : ''],
      ['Requirement / ticket', [req.id, req.title].filter(Boolean).join(' — ') || req.source],
      ['Source code reviewed', r.sourceCode?.provided ? 'Yes (read-only investigation)' : 'No'],
    ]),
    h('Requirement tested', 3),
    p(req.summary || (previewOnly
      ? 'No written requirement or design provided. The site was tested against standard Shopify/e-commerce behaviour, its own consistency across pages and viewports, obvious defects, and basic accessibility.'
      : 'No written requirement provided; Figma design used as the reference.')),
    ...(req.acceptanceCriteria?.length ? [h('Acceptance criteria', 3), ...numbered(req.acceptanceCriteria)] : []),

    // ---- 3. Environment ----
    h('3. Test Environment'),
    kv([
      ['Browsers', (env.browsers || []).join(', ')],
      ['Viewports', (env.viewports || []).join(', ')],
      ['Operating system', env.os],
      ['Test tool', 'Playwright-driven real browser session (Claude Code QA workspace)'],
      ['Notes', env.notes],
    ]),
    ...(r.outOfScope?.length ? [h('Out of scope', 3), ...list(r.outOfScope)] : []),

    // ---- 4. Coverage ----
    h('4. Test Coverage'),
    scenarios.length ? table(['Area', 'Scenarios', 'Pass', 'Fail', 'Blocked', 'Not verified'],
      areas.map((a) => {
        const xs = scenarios.filter((x) => (x.area || 'General') === a);
        const c = (st) => String(xs.filter((x) => x.status === st).length);
        return [a, String(xs.length), c('PASS'), c('FAIL'), c('BLOCKED'), c('NOT VERIFIED')];
      }), [36, 14, 12, 12, 12, 14]) : p('No scenarios recorded.', { italics: true }),

    // ---- 5. Status ----
    h('5. Overall Test Summary'),
    table(['Metric', 'Count'], [
      ['Total scenarios', s.scenarios.total], ['Passed', s.scenarios.passed], ['Failed', s.scenarios.failed],
      ['Blocked', s.scenarios.blocked], ['Not verified', s.scenarios.notVerified],
      ...SEVERITIES.map((x) => [`${x[0]}${x.slice(1).toLowerCase()} bugs`, s.severity[x]]),
      ...CATEGORIES.map((c) => [`${c} bugs`, s.category[c]]),
    ].map(([a, b]) => [a, String(b)]), [70, 30]),

    // ---- 6. Bug index ----
    h('6. Bugs Found'),
    bugs.length ? table(['ID', 'Title', 'Severity', 'Priority', 'Type', 'Viewport'],
      sortedBugs.map((b) => [cell(b.id, { bold: true }), b.title, cell(b.severity, { bold: true, color: SEV_COLOR[b.severity] }), b.priority || '-', b.category || '-', b.viewport || '-']),
      [11, 41, 12, 11, 12, 13]) : p('No confirmed bugs.', { italics: true }),

    // ---- 7. Issues by type ----
    h('7. Issues by Type'),
    h('UI / design issues', 3), ...list(byCat('UI')),
    h('Functional issues', 3), ...list(byCat('Functional')),
    h('Responsive issues', 3), ...list(byCat('Responsive')),
    h('Accessibility issues', 3), ...list(byCat('Accessibility')),

    // ---- 8. Detailed bugs ----
    h('8. Detailed Bug Reports'),
    p('Each bug below was reproduced before being reported. Marked screenshots highlight the exact affected area in red.', { color: COLORS.muted }),
    ...sortedBugs.flatMap(bugSection),

    // ---- 9. Regression ----
    new Paragraph({ children: [new PageBreak()] }),
    h('9. Regression Concerns'),
    ...list(r.regressionConcerns, 'No specific regression concerns noted.'),

    // ---- 10. Blocked / not verified ----
    h('10. Blocked, Not Verified and Observations'),
    h('Blocked / not tested', 3),
    ...list([
      ...scenarios.filter((x) => x.status === 'BLOCKED').map((x) => `${x.id} ${x.title} — ${x.notes || 'blocked'}`),
      ...observations.filter((o) => o.type === 'BLOCKED').map((o) => `${o.id} ${o.title} — ${o.details || ''}`),
    ]),
    h('Not verified', 3),
    ...list([
      ...scenarios.filter((x) => x.status === 'NOT VERIFIED').map((x) => `${x.id} ${x.title} — ${x.notes || 'could not be verified'}`),
      ...observations.filter((o) => o.type === 'NOT VERIFIED').map((o) => `${o.id} ${o.title} — ${o.details || ''}`),
    ]),
    h(previewOnly ? 'Visual suggestions (not treated as bugs; no design to compare against)' : 'Design differences (not treated as bugs)', 3),
    ...list(observations.filter((o) => o.type === 'DESIGN DIFFERENCE').map((o) => `${o.id} ${o.title} — ${o.details || ''}`)),
    h('Checked and working as expected', 3),
    ...list(observations.filter((o) => o.type === 'EXPECTED BEHAVIOR').map((o) => `${o.id} ${o.title} — ${o.details || ''}`)),

    // ---- Appendix ----
    h('Appendix A — Scenario Log'),
    scenarios.length ? table(['ID', 'Scenario', 'Viewport', 'Status', 'Bugs'],
      scenarios.map((x) => [x.id, x.title, x.viewport || '-', cell(x.status, { bold: true, color: x.status === 'PASS' ? '15803D' : x.status === 'FAIL' ? '991B1B' : 'B45309' }), (x.bugIds || []).join(', ') || '-']),
      [10, 50, 14, 13, 13]) : p('No scenarios recorded.', { italics: true }),
  ];

  const doc = new Document({
    creator: r.tester || 'QA',
    title: `QA Report - ${project}`,
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: COLORS.text } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '111827' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 27, bold: true, color: COLORS.accent } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '374151' } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          run(`QA Report — ${project} — ${date}    Page `, { size: 16, color: COLORS.muted }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLORS.muted, font: FONT }),
        ] })] }),
      },
      children,
    }],
  });

  // Keep only the newest report in reports/latest; older ones move to reports/archive.
  mkdirp(DIRS.reportsLatest);
  mkdirp(DIRS.reportsArchive);
  const fileName = `QA-Report-${slugify(project)}-${date}.docx`;
  for (const f of fs.readdirSync(DIRS.reportsLatest)) {
    if (f.endsWith('.docx') && f !== fileName) fs.renameSync(path.join(DIRS.reportsLatest, f), path.join(DIRS.reportsArchive, f));
  }
  const out = path.join(DIRS.reportsLatest, fileName);
  fs.writeFileSync(out, await Packer.toBuffer(doc));
  return out;
}

module.exports = { buildReport };
