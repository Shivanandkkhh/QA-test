// Image utilities rendered with the browser: mark an existing image, and website-vs-Figma comparisons.
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');
const { imageSize, mkdirp } = require('./common');

function dataUri(file) {
  const { type } = imageSize(file);
  return `data:image/${type === 'jpg' ? 'jpeg' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function renderHtml(html, outFile, { width = 1400, height = 900, fullPage = true } = {}) {
  mkdirp(path.dirname(outFile));
  const browser = await launch('chrome');
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outFile, fullPage });
  await browser.close();
  return outFile;
}

// boxes: [{x,y,width,height,label}] in the image's own pixel coordinates.
async function markImage(inFile, outFile, boxes) {
  const { width, height } = imageSize(inFile);
  const pad = 4;
  const marks = boxes.map((b) => {
    const above = b.y - pad - 30 > 0;
    return `<div style="position:absolute;left:${b.x - pad}px;top:${b.y - pad}px;width:${b.width + pad * 2}px;height:${b.height + pad * 2}px;border:3px solid #E5202E;border-radius:4px;box-shadow:0 0 0 2px rgba(255,255,255,.85);box-sizing:border-box"></div>` +
      (b.label ? `<div style="position:absolute;left:${Math.max(4, b.x - pad)}px;top:${above ? b.y - pad - 30 : b.y + b.height + pad + 4}px;max-width:360px;background:#E5202E;color:#fff;font:600 13px/1.3 -apple-system,Helvetica,Arial,sans-serif;padding:5px 8px;border-radius:4px">${esc(b.label)}</div>` : '');
  }).join('');
  const html = `<html><body style="margin:0"><div style="position:relative;width:${width}px;height:${height}px"><img src="${dataUri(inFile)}" style="display:block;width:${width}px;height:${height}px">${marks}</div></body></html>`;
  return renderHtml(html, outFile, { width, height, fullPage: false });
}

// Side-by-side "Website (actual)" vs "Figma (expected)" image with an optional note.
async function compareImages(websiteFile, figmaFile, outFile, { title = '', note = '' } = {}) {
  const colW = 680;
  const html = `<html><body style="margin:0;background:#F4F4F5;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#18181B">
  <div style="padding:24px 28px">
    ${title ? `<div style="font-size:22px;font-weight:700;margin-bottom:6px">${esc(title)}</div>` : ''}
    ${note ? `<div style="font-size:14px;color:#52525B;margin-bottom:16px;max-width:1300px">${esc(note)}</div>` : ''}
    <div style="display:flex;gap:24px;align-items:flex-start">
      ${[['Website (actual)', websiteFile, '#E5202E'], ['Figma (expected)', figmaFile, '#16A34A']].map(([label, f, c]) => `
      <div style="width:${colW}px;background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.12)">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${c};margin-bottom:10px">${label}</div>
        <img src="${dataUri(f)}" style="display:block;max-width:100%;height:auto;border:1px solid #E4E4E7">
      </div>`).join('')}
    </div>
  </div></body></html>`;
  return renderHtml(html, outFile, { width: colW * 2 + 24 + 56, height: 600 });
}

module.exports = { markImage, compareImages, renderHtml, dataUri, esc };
