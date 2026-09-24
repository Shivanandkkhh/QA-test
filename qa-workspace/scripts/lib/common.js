// Shared helpers: workspace paths, run folders, JSON files, image sizes.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = {
  input: path.join(ROOT, 'input'),
  results: path.join(ROOT, 'test-results'),
  screenshots: path.join(ROOT, 'evidence', 'screenshots'),
  marked: path.join(ROOT, 'evidence', 'marked'),
  comparison: path.join(ROOT, 'evidence', 'comparison'),
  reportsLatest: path.join(ROOT, 'reports', 'latest'),
  reportsArchive: path.join(ROOT, 'reports', 'archive'),
  figmaPackage: path.join(ROOT, 'figma-package'),
};
const CURRENT_FILE = path.join(DIRS.results, '.current');

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CATEGORIES = ['UI', 'Functional', 'Responsive', 'Accessibility'];
const SCENARIO_STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'NOT VERIFIED'];
const OBSERVATION_TYPES = ['EXPECTED BEHAVIOR', 'DESIGN DIFFERENCE', 'NOT VERIFIED', 'BLOCKED'];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function abs(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

// The active run is stored in test-results/.current so commands don't need --run every time.
function resolveRun(runArg) {
  const id = runArg || (fs.existsSync(CURRENT_FILE) ? fs.readFileSync(CURRENT_FILE, 'utf8').trim() : '');
  if (!id) throw new Error('No active QA run. Start one with: node scripts/qa.js new-run "<Project Name>"');
  const dir = path.join(DIRS.results, id);
  if (!fs.existsSync(dir)) throw new Error(`Run folder not found: ${rel(dir)}`);
  return {
    id,
    dir,
    runFile: path.join(dir, 'run.json'),
    bugsFile: path.join(dir, 'bugs.json'),
    scenariosFile: path.join(dir, 'scenarios.json'),
    observationsFile: path.join(dir, 'observations.json'),
    logsDir: path.join(dir, 'logs'),
    screenshotsDir: path.join(DIRS.screenshots, id),
    markedDir: path.join(DIRS.marked, id),
    comparisonDir: path.join(DIRS.comparison, id),
  };
}

function loadRunData(run) {
  return {
    run: readJson(run.runFile, {}),
    bugs: readJson(run.bugsFile, []),
    scenarios: readJson(run.scenariosFile, []),
    observations: readJson(run.observationsFile, []),
  };
}

// Credentials live only in input/credentials.local.json and are never written to reports.
function loadCredentials() {
  return readJson(path.join(DIRS.input, 'credentials.local.json'), {});
}

// Reads width/height from PNG or JPEG headers (no image library needed).
function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(1, 4).toString() === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + len;
    }
  }
  throw new Error(`Unsupported image (use PNG or JPEG): ${file}`);
}

function summarize({ bugs, scenarios }) {
  const count = (list, key, value) => list.filter((x) => x[key] === value).length;
  return {
    scenarios: {
      total: scenarios.length,
      passed: count(scenarios, 'status', 'PASS'),
      failed: count(scenarios, 'status', 'FAIL'),
      blocked: count(scenarios, 'status', 'BLOCKED'),
      notVerified: count(scenarios, 'status', 'NOT VERIFIED'),
    },
    severity: Object.fromEntries(SEVERITIES.map((s) => [s, count(bugs, 'severity', s)])),
    category: Object.fromEntries(CATEGORIES.map((c) => [c, count(bugs, 'category', c)])),
    releaseBlocking: bugs.filter((b) => b.releaseBlocking),
  };
}

function verdict(data) {
  if (data.run.verdict) return data.run.verdict;
  const s = summarize(data);
  if (s.releaseBlocking.length || s.severity.CRITICAL) return 'NOT READY FOR RELEASE';
  if (s.severity.HIGH) return 'RELEASE AT RISK - HIGH SEVERITY ISSUES OPEN';
  if (data.bugs.length) return 'READY WITH MINOR ISSUES';
  return 'NO CONFIRMED BUGS';
}

module.exports = {
  ROOT, DIRS, CURRENT_FILE, SEVERITIES, CATEGORIES, SCENARIO_STATUSES, OBSERVATION_TYPES,
  mkdirp, readJson, writeJson, slugify, today, rel, abs, resolveRun, loadRunData,
  loadCredentials, imageSize, summarize, verdict,
};
