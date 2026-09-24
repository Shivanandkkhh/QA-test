// Fallback when Figma can't be written to (view/Dev seat, or no MCP write access):
// renders one PNG "bug card" per bug plus a board, ready to drag onto the Figma "QA - Bug Reports" page.
const fs = require('fs');
const path = require('path');
const { renderHtml, dataUri, esc } = require('./images');
const { DIRS, mkdirp, abs, rel, SEVERITIES, CATEGORIES } = require('./common');

const SEV_BG = { CRITICAL: '#991B1B', HIGH: '#C2410C', MEDIUM: '#B45309', LOW: '#2563EB' };

function cardHtml(b) {
  const img = [b.evidence?.marked, b.evidence?.screenshot].map((f) => f && abs(f)).find((f) => f && fs.existsSync(f));
  const row = (k, v) => (v ? `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">${k}</div><div style="font-size:15px;line-height:1.45;margin-top:3px">${esc(v)}</div></div>` : '');
  return `<div style="width:560px;background:#fff;border:1px solid #E5E7EB;border-top:6px solid ${SEV_BG[b.severity] || '#6B7280'};border-radius:10px;padding:20px 22px;box-sizing:border-box;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111827">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:20px;font-weight:800">${esc(b.id)}</div>
      <div style="background:${SEV_BG[b.severity] || '#6B7280'};color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px">Severity: ${esc(b.severity)}</div>
    </div>
    <div style="font-size:17px;font-weight:700;margin-top:6px">${esc(b.title)}</div>
    <div style="font-size:13px;color:#6B7280;margin-top:4px">${esc([b.category, b.component, b.viewport, b.browser].filter(Boolean).join(' · '))}</div>
    ${row('Issue', b.description)}
    ${row('Expected', b.expected)}
    ${row('Actual', b.actual)}
    ${row('Page', b.url || b.page)}
    ${img ? `<div style="margin-top:14px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">Evidence</div><img src="${dataUri(img)}" style="display:block;max-width:100%;max-height:640px;margin-top:6px;border:1px solid #E5E7EB;border-radius:6px">` : row('Evidence', 'See Word report / evidence folder')}
  </div>`;
}

async function buildFigmaPackage(runInfo, data) {
  const outDir = mkdirp(path.join(DIRS.figmaPackage, runInfo.id));
  const bugs = [...data.bugs].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id));
  const files = [];
  for (const b of bugs) {
    const f = path.join(outDir, `${b.id}-card.png`);
    await renderHtml(`<html><body style="margin:0;padding:16px;background:#F3F4F6;display:inline-block">${cardHtml(b)}</body></html>`, f, { width: 592, height: 400 });
    files.push(rel(f));
  }
  // Board: one column per category, matching the Figma QA page layout.
  const cols = CATEGORIES.map((c) => `<div style="width:592px;flex:none">
      <div style="font:800 26px -apple-system,Helvetica,Arial,sans-serif;color:#111827;margin:0 0 14px 4px">${c} Bugs (${bugs.filter((b) => b.category === c).length})</div>
      <div style="display:flex;flex-direction:column;gap:18px">${bugs.filter((b) => b.category === c).map(cardHtml).join('') || '<div style="font:15px -apple-system,Arial;color:#6B7280;margin-left:4px">None</div>'}</div>
    </div>`).join('');
  const board = path.join(outDir, 'QA-Bug-Board.png');
  await renderHtml(`<html><body style="margin:0;background:#F3F4F6"><div style="padding:40px">
      <div style="font:800 36px -apple-system,Helvetica,Arial,sans-serif;color:#111827">QA - Bug Reports · ${esc(data.run.project || runInfo.id)}</div>
      <div style="font:16px -apple-system,Arial;color:#6B7280;margin:6px 0 30px">${esc(data.run.date || '')} · ${bugs.length} confirmed bug(s) · Run ${esc(runInfo.id)}</div>
      <div style="display:flex;gap:32px;align-items:flex-start">${cols}</div></div></body></html>`, board, { width: 4 * 592 + 3 * 32 + 80, height: 800 });
  files.push(rel(board));
  fs.writeFileSync(path.join(outDir, 'HOW-TO-ADD-TO-FIGMA.md'), `# Add these bugs to Figma manually

Claude could not write to the Figma file directly, so the bug cards were saved here as images.

1. Open the Figma file and go to the page **QA - Bug Reports** (create it if it doesn't exist).
2. Drag \`QA-Bug-Board.png\` onto the page for the full board, **or**
   drag the individual \`BUG-xxx-card.png\` files under the matching headings:
   UI Bugs / Functional Bugs / Responsive Bugs / Accessibility Bugs.
3. Optional: place each card next to a copy of the related design frame. Don't place anything on the original design pages.

Cards in this folder:
${files.map((f) => `- ${path.basename(f)}`).join('\n')}
`);
  return { outDir: rel(outDir), files };
}

module.exports = { buildFigmaPackage };
