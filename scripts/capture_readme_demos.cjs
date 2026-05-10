#!/usr/bin/env node
/* Capture real browser GIF demos for README.md. */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const DOCS_ASSETS = path.join(ROOT, 'docs', 'assets');
const EXAMPLE_LIBRARY = path.join(ROOT, 'examples', 'officewhere_test_library');
const ARTIFACT_ROOT = path.join(ROOT, '.omx', 'artifacts', 'readme-demo');
const LOCAL_BROWSER_LIB = path.join(ROOT, '.omx', 'browser-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const LOCAL_FFMPEG = path.join(ROOT, '.omx', 'tools', 'ffmpeg', 'ffmpeg');
const VIEWPORT = { width: 1440, height: 960 };
const GIF_WIDTH = 980;
const GIF_FPS = 12;
const GIF_HEIGHT = Math.round((VIEWPORT.height * GIF_WIDTH) / VIEWPORT.width);
const CAPTURE_LIMITS = {
  maxWidth: 1600,
  maxHeight: 1100,
  maxDurationMs: 35_000,
  maxBytes: 14 * 1024 * 1024,
};
const CLIP_OUTPUTS = {
  search: path.join(DOCS_ASSETS, 'readme-demo-search.gif'),
  version: path.join(DOCS_ASSETS, 'readme-demo-version.gif'),
};
const STILL_OUTPUTS = {
  duplicates: path.join(DOCS_ASSETS, 'readme-demo-duplicates.png'),
};

function nodeModule(name) {
  return require(path.join(FRONTEND, 'node_modules', name));
}

const { chromium } = nodeModule('@playwright/test');

function parseArgs(argv) {
  const args = { keepFrames: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep-frames' || arg === '--keep-workdir') args.keepFrames = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/capture_readme_demos.cjs [--keep-frames]');
      process.exit(0);
    }
  }
  return args;
}

function commandOnPath(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
    cwd: ROOT,
    env: runtimeEnv(),
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function findFfmpeg() {
  if (process.env.FFMPEG_BIN && fss.existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
  if (fss.existsSync(LOCAL_FFMPEG)) return LOCAL_FFMPEG;
  const pathFfmpeg = commandOnPath('ffmpeg');
  if (pathFfmpeg) return pathFfmpeg;
  throw new Error(
    `FFmpeg binary not found. Install ffmpeg, set FFMPEG_BIN, or place a binary at ${path.relative(ROOT, LOCAL_FFMPEG)}.`,
  );
}

function runtimeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (fss.existsSync(LOCAL_BROWSER_LIB)) {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${LOCAL_BROWSER_LIB}:${env.LD_LIBRARY_PATH}`
      : LOCAL_BROWSER_LIB;
  }
  return env;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function startProcess(command, args, options = {}) {
  const { env: extraEnv, ...spawnOptions } = options;
  const child = spawn(command, args, {
    cwd: ROOT,
    env: runtimeEnv(extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOptions,
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${path.basename(command)}] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${path.basename(command)}] ${chunk}`));
  return child;
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5000).then(() => {
      if (!child.killed) child.kill('SIGKILL');
    }),
  ]);
}

async function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: runtimeEnv(options.env || {}),
      stdio: options.stdio || 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`))));
    child.on('error', reject);
  });
}

async function transcodeVideoToGif(input, output, trimStartSec, durationSec) {
  const ffmpeg = findFfmpeg();
  const palette = `${output}.palette.png`;
  const videoFilter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.rm(output, { force: true });
  await fs.rm(palette, { force: true });
  await runChild(ffmpeg, [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-ss', trimStartSec.toFixed(3),
    '-t', durationSec.toFixed(3),
    '-i', input,
    '-vf', `${videoFilter},palettegen=stats_mode=diff`,
    '-frames:v', '1',
    palette,
  ]);
  await runChild(ffmpeg, [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-ss', trimStartSec.toFixed(3),
    '-t', durationSec.toFixed(3),
    '-i', input,
    '-i', palette,
    '-lavfi', `${videoFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-loop', '0',
    output,
  ]);
  await fs.rm(palette, { force: true });
}

async function copyLibrary(dst) {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.cp(EXAMPLE_LIBRARY, dst, { recursive: true, force: true });
  const duplicateDir = path.join(dst, '06_중복샘플');
  await fs.mkdir(duplicateDir, { recursive: true });
  await fs.copyFile(
    path.join(dst, '03_부서A', '공통양식.xlsx'),
    path.join(duplicateDir, '부서공통양식_확인본.xlsx'),
  );
}

async function api(backendUrl, endpoint, options = {}) {
  const response = await fetch(`${backendUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${endpoint} failed ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function prepareLibrary(backendUrl, libraryPath) {
  const settings = await api(backendUrl, '/api/library/settings');
  await api(backendUrl, '/api/library/settings', {
    method: 'PUT',
    body: JSON.stringify({
      ...settings,
      watched_folders: [{ path: libraryPath, recursive: true }],
    }),
  });
  await api(backendUrl, '/api/library/rescan/start', {
    method: 'POST',
    body: JSON.stringify({ mode: 'fast' }),
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await api(backendUrl, '/api/library/rescan/status');
    if (!status.running && status.stage === 'completed' && (status.registered + status.updated + status.skipped) > 0) {
      break;
    }
    await delay(900);
  }

  const readyDeadline = Date.now() + 45_000;
  while (Date.now() < readyDeadline) {
    const groups = await api(backendUrl, '/api/library/groups?limit=20&offset=0&cache_only=false');
    const duplicates = await api(backendUrl, '/api/files/duplicates?limit=5&offset=0');
    if ((groups.total || 0) > 0 && (duplicates.total || 0) > 0) return;
    await delay(900);
  }
  throw new Error('library groups or duplicate fixture did not become ready');
}

async function installSanitizer(context, libraryPath) {
  await context.addInitScript(({ libraryPath }) => {
    const normalized = libraryPath.replaceAll('\\', '/');
    const rewrite = (value) => {
      let next = String(value || '');
      next = next.split(libraryPath).join('OfficeWhere 데모 폴더');
      next = next.split(normalized).join('OfficeWhere 데모 폴더');
      next = next.replace(/\/tmp\/OfficeWhere[-_\w가-힣]+/g, 'OfficeWhere 데모 폴더');
      next = next.replace(/\/home\/[^/\s]+/g, '데모 환경');
      next = next.replace(/\/Users\/[^/\s]+/g, '데모 환경');
      next = next.replace(/AppData[\\/][^\s]+/g, '데모 환경');
      return next;
    };
    const sanitize = () => {
      if (!document.body) return;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const next = rewrite(node.nodeValue);
        if (node.nodeValue !== next) node.nodeValue = next;
      }
      document.querySelectorAll('[title], [aria-label]').forEach((element) => {
        for (const attr of ['title', 'aria-label']) {
          const value = element.getAttribute(attr);
          const next = rewrite(value);
          if (value !== next) element.setAttribute(attr, next);
        }
      });
    };
    window.localStorage.setItem('officewhere:onboarding-complete:v1', 'true');
    window.addEventListener('DOMContentLoaded', () => {
      sanitize();
      const observer = new MutationObserver(sanitize);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      window.setInterval(sanitize, 800);
    });
  }, { libraryPath });
}

async function clickNav(page, label) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0 }));
  const names = { 검색: /검색/, 이력: /이력|변경 이력/, 중복: /중복|같은 내용/ };
  await page.getByRole('navigation', { name: '메인 내비게이션' }).getByRole('button', { name: names[label] || label }).click();
  await page.waitForTimeout(900);
}

async function spotlight(page, locator, icon = 'target', durationMs = 3000, options = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(250);
  const rect = await locator.boundingBox().catch(() => null);
  if (!rect) {
    await page.waitForTimeout(durationMs);
    return;
  }

  const startedAt = Date.now();
  await page.evaluate(({ rect, icon, durationMs, options }) => {
    const ICONS = {
      search:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></svg>',
      list:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>',
      target:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
      delta:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 21h18L12 3Z"/><path d="M12 9v5M12 17.5v.1"/></svg>',
      grid:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 10h16M4 15h16M9 5v14M15 5v14"/></svg>',
      copy:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v10H8z"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      filter:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/></svg>',
      check:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    };
    const rootId = 'officewhere-demo-spotlight';
    const styleId = 'officewhere-demo-spotlight-style';
    document.getElementById(rootId)?.remove();
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .ow-demo-spotlight-root {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          pointer-events: none;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .ow-demo-spotlight-hole {
          position: fixed;
          border: 3px solid rgba(31, 107, 163, 0.96);
          border-radius: 18px;
          box-shadow:
            0 0 0 9999px rgba(8, 16, 28, 0.42),
            0 0 0 8px rgba(31, 107, 163, 0.11),
            0 18px 52px rgba(8, 18, 36, 0.22);
          background: rgba(255, 255, 255, 0.02);
          animation: owDemoPulse 1.45s ease-in-out infinite;
        }
        .ow-demo-spotlight-bubble {
          position: fixed;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 58px;
          height: 58px;
          border-radius: 9999px;
          border: 1px solid rgba(31, 107, 163, 0.22);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 46px rgba(8, 18, 36, 0.24);
        }
        .ow-demo-spotlight-bubble svg {
          width: 30px;
          height: 30px;
          fill: none;
          stroke: rgb(31, 89, 135);
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .ow-demo-spotlight-bubble::after {
          content: "";
          position: absolute;
          width: 12px;
          height: 12px;
          background: rgba(255, 255, 255, 0.96);
          transform: rotate(45deg);
          border-right: 1px solid rgba(31, 107, 163, 0.16);
          border-bottom: 1px solid rgba(31, 107, 163, 0.16);
          bottom: -6px;
        }
        .ow-demo-spotlight-root[data-placement="below"] .ow-demo-spotlight-bubble::after {
          bottom: auto;
          top: -6px;
          border-right: 0;
          border-bottom: 0;
          border-left: 1px solid rgba(31, 107, 163, 0.16);
          border-top: 1px solid rgba(31, 107, 163, 0.16);
        }
        @keyframes owDemoPulse {
          0%, 100% { outline: 0 solid rgba(31, 107, 163, 0); }
          50% { outline: 7px solid rgba(31, 107, 163, 0.17); }
        }
      `;
      document.head.appendChild(style);
    }

    const padding = options.padding ?? 10;
    const width = Math.min(window.innerWidth - 24, rect.width + padding * 2);
    const height = Math.min(window.innerHeight - 24, rect.height + padding * 2);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.x - padding));
    const top = Math.max(12, Math.min(window.innerHeight - height - 12, rect.y - padding));
    const placement = top > 86 ? 'above' : 'below';

    const root = document.createElement('div');
    root.id = rootId;
    root.className = 'ow-demo-spotlight-root';
    root.dataset.placement = placement;

    const hole = document.createElement('div');
    hole.className = 'ow-demo-spotlight-hole';
    Object.assign(hole.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      borderRadius: `${options.radius ?? 18}px`,
    });

    const bubble = document.createElement('div');
    bubble.className = 'ow-demo-spotlight-bubble';
    bubble.innerHTML = ICONS[icon] || ICONS.target;
    const bubbleLeft = Math.max(18, Math.min(window.innerWidth - 76, left + width / 2 - 29));
    const bubbleTop = placement === 'above'
      ? Math.max(18, top - 78)
      : Math.min(window.innerHeight - 76, top + height + 20);
    Object.assign(bubble.style, {
      left: `${bubbleLeft}px`,
      top: `${bubbleTop}px`,
    });

    root.append(hole, bubble);
    document.body.appendChild(root);
    window.setTimeout(() => {
      root.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.985)' }],
        { duration: 220, easing: 'ease-out' },
      ).finished.finally(() => root.remove());
    }, Math.max(300, durationMs - 240));
  }, { rect, icon, durationMs, options });

  await page.waitForTimeout(180);
  if (page.__demoScreenshotDir && page.__demoClipName) {
    page.__demoSpotlightIndex = (page.__demoSpotlightIndex || 0) + 1;
    const safeIcon = String(icon).replace(/[^a-z0-9_-]/gi, '');
    const screenshotPath = path.join(
      page.__demoScreenshotDir,
      `${page.__demoClipName}-spotlight-${String(page.__demoSpotlightIndex).padStart(2, '0')}-${safeIcon}.png`,
    );
    await page.screenshot({ path: screenshotPath, animations: 'disabled' }).catch(() => {});
  }
  const remainingMs = durationMs - (Date.now() - startedAt);
  if (remainingMs > 0) await page.waitForTimeout(remainingMs);
}

async function spotlightRects(page, rects, icon = 'target', durationMs = 3000, options = {}) {
  const visibleRects = rects
    .filter((rect) => rect && rect.width > 2 && rect.height > 2)
    .slice(0, options.maxRects ?? 8);
  if (visibleRects.length === 0) {
    await page.waitForTimeout(durationMs);
    return;
  }

  const startedAt = Date.now();
  await page.evaluate(({ rects, icon, durationMs, options }) => {
    const ICONS = {
      list:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>',
      target:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    };
    const rootId = 'officewhere-demo-group-spotlight';
    const styleId = 'officewhere-demo-group-spotlight-style';
    document.getElementById(rootId)?.remove();
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .ow-demo-group-spotlight-root {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          pointer-events: none;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .ow-demo-group-spotlight-svg {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
        }
        .ow-demo-group-spotlight-ring {
          position: fixed;
          border: 3px solid rgba(31, 107, 163, 0.96);
          box-shadow:
            0 0 0 8px rgba(31, 107, 163, 0.11),
            0 18px 52px rgba(8, 18, 36, 0.2);
          animation: owDemoGroupPulse 1.45s ease-in-out infinite;
        }
        .ow-demo-group-spotlight-bubble {
          position: fixed;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 9999px;
          border: 1px solid rgba(31, 107, 163, 0.2);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 46px rgba(8, 18, 36, 0.24);
        }
        .ow-demo-group-spotlight-bubble svg {
          width: 30px;
          height: 30px;
          fill: none;
          stroke: rgb(31, 89, 135);
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        @keyframes owDemoGroupPulse {
          0%, 100% { outline: 0 solid rgba(31, 107, 163, 0); }
          50% { outline: 7px solid rgba(31, 107, 163, 0.16); }
        }
      `;
      document.head.appendChild(style);
    }

    const padding = options.padding ?? 8;
    const radius = options.radius ?? 16;
    const preparedRects = rects.map((rect) => {
      const left = Math.max(12, rect.x - padding);
      const top = Math.max(12, rect.y - padding);
      const right = Math.min(window.innerWidth - 12, rect.x + rect.width + padding);
      const bottom = Math.min(window.innerHeight - 12, rect.y + rect.height + padding);
      return {
        left,
        top,
        width: Math.max(8, right - left),
        height: Math.max(8, bottom - top),
      };
    });
    const union = preparedRects.reduce((acc, rect) => ({
      left: Math.min(acc.left, rect.left),
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.left + rect.width),
      bottom: Math.max(acc.bottom, rect.top + rect.height),
    }), {
      left: window.innerWidth,
      top: window.innerHeight,
      right: 0,
      bottom: 0,
    });

    const root = document.createElement('div');
    root.id = rootId;
    root.className = 'ow-demo-group-spotlight-root';
    const maskId = `ow-demo-group-mask-${Date.now()}`;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.classList.add('ow-demo-group-spotlight-svg');
    const defs = document.createElementNS(svgNs, 'defs');
    const mask = document.createElementNS(svgNs, 'mask');
    mask.setAttribute('id', maskId);
    const fullMask = document.createElementNS(svgNs, 'rect');
    fullMask.setAttribute('x', '0');
    fullMask.setAttribute('y', '0');
    fullMask.setAttribute('width', '100%');
    fullMask.setAttribute('height', '100%');
    fullMask.setAttribute('fill', 'white');
    mask.appendChild(fullMask);
    for (const rect of preparedRects) {
      const hole = document.createElementNS(svgNs, 'rect');
      hole.setAttribute('x', String(rect.left));
      hole.setAttribute('y', String(rect.top));
      hole.setAttribute('width', String(rect.width));
      hole.setAttribute('height', String(rect.height));
      hole.setAttribute('rx', String(radius));
      hole.setAttribute('fill', 'black');
      mask.appendChild(hole);
    }
    defs.appendChild(mask);
    const dim = document.createElementNS(svgNs, 'rect');
    dim.setAttribute('x', '0');
    dim.setAttribute('y', '0');
    dim.setAttribute('width', '100%');
    dim.setAttribute('height', '100%');
    dim.setAttribute('fill', 'rgba(8, 16, 28, 0.42)');
    dim.setAttribute('mask', `url(#${maskId})`);
    svg.append(defs, dim);
    root.appendChild(svg);

    for (const rect of preparedRects) {
      const ring = document.createElement('div');
      ring.className = 'ow-demo-group-spotlight-ring';
      Object.assign(ring.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${radius}px`,
      });
      root.appendChild(ring);
    }

    const bubble = document.createElement('div');
    bubble.className = 'ow-demo-group-spotlight-bubble';
    bubble.innerHTML = ICONS[icon] || ICONS.target;
    Object.assign(bubble.style, {
      left: `${Math.max(18, Math.min(window.innerWidth - 74, union.left + (union.right - union.left) / 2 - 28))}px`,
      top: `${Math.max(18, Math.min(window.innerHeight - 74, union.top - 76))}px`,
    });
    root.appendChild(bubble);
    document.body.appendChild(root);

    window.setTimeout(() => {
      root.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.985)' }],
        { duration: 220, easing: 'ease-out' },
      ).finished.finally(() => root.remove());
    }, Math.max(300, durationMs - 240));
  }, { rects: visibleRects, icon, durationMs, options });

  await page.waitForTimeout(180);
  if (page.__demoScreenshotDir && page.__demoClipName) {
    page.__demoSpotlightIndex = (page.__demoSpotlightIndex || 0) + 1;
    const safeIcon = String(icon).replace(/[^a-z0-9_-]/gi, '');
    const screenshotPath = path.join(
      page.__demoScreenshotDir,
      `${page.__demoClipName}-spotlight-${String(page.__demoSpotlightIndex).padStart(2, '0')}-${safeIcon}.png`,
    );
    await page.screenshot({ path: screenshotPath, animations: 'disabled' }).catch(() => {});
  }
  const remainingMs = durationMs - (Date.now() - startedAt);
  if (remainingMs > 0) await page.waitForTimeout(remainingMs);
}

async function spotlightVisibleSearchTerms(page, needle, durationMs = 3000) {
  const rects = await page.locator('mark').evaluateAll((marks, expectedText) => {
    const seen = new Set();
    return marks
      .filter((mark) => mark.textContent?.includes(expectedText))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        const key = `${Math.round(left)}:${Math.round(top)}:${Math.round(right)}:${Math.round(bottom)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        if (right <= 110 || bottom <= 84 || left >= window.innerWidth || top >= window.innerHeight) return null;
        if (right - left < 6 || bottom - top < 6) return null;
        return { x: left, y: top, width: right - left, height: bottom - top };
      })
      .filter(Boolean);
  }, needle);
  await spotlightRects(page, rects, 'target', durationMs, { padding: 10, radius: 10, maxRects: 10 });
}

async function clearSpotlight(page) {
  await page.evaluate(() => {
    document.getElementById('officewhere-demo-spotlight')?.remove();
    document.getElementById('officewhere-demo-group-spotlight')?.remove();
  }).catch(() => {});
}

async function smoothWheel(page, totalDeltaY, steps = 8, pauseMs = 110) {
  const step = totalDeltaY / steps;
  await page.mouse.move(VIEWPORT.width * 0.68, VIEWPORT.height * 0.72).catch(() => {});
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(pauseMs);
  }
}

async function smoothWheelAt(page, locator, totalDeltaY, steps = 8, pauseMs = 110, offset = { x: 24, y: 24 }) {
  const box = await locator.boundingBox().catch(() => null);
  if (box) {
    const x = Math.max(20, Math.min(VIEWPORT.width - 20, box.x + offset.x));
    const y = Math.max(20, Math.min(VIEWPORT.height - 20, box.y + offset.y));
    await page.mouse.move(x, y).catch(() => {});
  }
  const step = totalDeltaY / steps;
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(pauseMs);
  }
}

async function startClip(browser, viteUrl, workDir, name, libraryPath, action, options = {}) {
  const rawVideoDir = path.join(workDir, 'raw-video', name);
  const screenshotDir = path.join(workDir, 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.rm(rawVideoDir, { recursive: true, force: true });
  await fs.mkdir(rawVideoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    recordVideo: {
      dir: rawVideoDir,
      size: VIEWPORT,
    },
  });
  await installSanitizer(context, libraryPath);
  const page = await context.newPage();
  page.__demoScreenshotDir = screenshotDir;
  page.__demoClipName = name;
  page.__demoSpotlightIndex = 0;
  const clipOpenedAt = Date.now();
  await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const actionStartedAt = Date.now();
  await action(page);
  await clearSpotlight(page);
  await page.waitForTimeout(1100);
  const actionEndedAt = Date.now();
  const screenshot = path.join(screenshotDir, `${name}-final.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  const video = page.video();
  await context.close();
  const output = CLIP_OUTPUTS[name];
  const rawVideoPath = video ? await video.path() : null;
  if (!rawVideoPath) throw new Error(`native video recording was not available for ${name}`);
  const trimStartSec = Math.max(0, (actionStartedAt - clipOpenedAt) / 1000);
  const durationMs = Math.max(1, actionEndedAt - actionStartedAt);
  await transcodeVideoToGif(rawVideoPath, output, trimStartSec, durationMs / 1000);
  if (!options.keepFrames) {
    await fs.rm(rawVideoDir, { recursive: true, force: true });
  }
  return {
    name,
    output,
    width: GIF_WIDTH,
    height: GIF_HEIGHT,
    duration_ms: durationMs,
    fps: GIF_FPS,
    frame_count: Math.round(durationMs / 1000 * GIF_FPS),
    bytes: (await fs.stat(output)).size,
    screenshot,
    encoder: 'ffmpeg/palette-gif',
    dither: 'bayer',
    capture: 'playwright-native-video',
  };
}

async function captureStill(browser, viteUrl, workDir, name, libraryPath, action) {
  const screenshotDir = path.join(workDir, 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  await installSanitizer(context, libraryPath);
  const page = await context.newPage();
  page.__demoScreenshotDir = screenshotDir;
  page.__demoClipName = name;
  page.__demoSpotlightIndex = 0;
  await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await action(page);
  await clearSpotlight(page);
  await page.waitForTimeout(600);
  const output = STILL_OUTPUTS[name];
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.rm(output, { force: true });
  await page.screenshot({ path: output, animations: 'disabled' });
  const artifactScreenshot = path.join(screenshotDir, `${name}-final.png`);
  await fs.copyFile(output, artifactScreenshot);
  await context.close();
  return {
    name,
    output,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    duration_ms: null,
    fps: null,
    frame_count: 1,
    bytes: (await fs.stat(output)).size,
    screenshot: artifactScreenshot,
  };
}

async function captureSearch(page) {
  await clickNav(page, '검색');
  const input = page.getByPlaceholder(/파일 안의 단어를 검색/);
  await spotlight(page, input, 'search', 3000, { radius: 24, padding: 14 });
  await input.fill('');
  await page.waitForTimeout(200);
  await input.pressSequentially('일정', { delay: 90 });
  await page.waitForTimeout(250);
  await page.locator('button:has-text("검색")').last().click();
  await page.getByText(/개 파일|개 위치|본문 미리보기|본문 위치/).first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(350);
  const collapseAll = page.getByRole('button', { name: '본문 위치 접기' }).first();
  if (await collapseAll.isVisible({ timeout: 1200 }).catch(() => false)) {
    await collapseAll.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(280);
  }
  await smoothWheel(page, 540, 10, 55);
  await page.waitForTimeout(700);
  await spotlightVisibleSearchTerms(page, '일정', 3000);
  await page.waitForTimeout(400);
}

async function captureVersion(page) {
  await clickNav(page, '이력');
  const groupInput = page.getByPlaceholder('문서명, 파일명, 폴더명으로 찾기');
  await groupInput.waitFor({ state: 'visible', timeout: 30_000 });
  await spotlight(page, groupInput, 'search', 3000, { radius: 18, padding: 12 });
  await page.waitForTimeout(160);
  await groupInput.pressSequentially('사업예산', { delay: 65 });
  await page.waitForTimeout(220);
  await page.getByRole('button', { name: '찾기' }).click();
  await page.getByText('사업예산').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(220);
  const detailButton = page.getByRole('button', { name: '변경 내용 보기' }).first();
  await spotlight(page, detailButton, 'delta', 3000, { padding: 12 });
  await detailButton.click();
  await page.getByRole('button', { name: '접기' }).first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.getByText('변경 내용 상세').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(350);
  await smoothWheel(page, 720, 12, 70);
  await page.waitForTimeout(500);
  await smoothWheel(page, -620, 10, 60);
  const sheetButton = page.getByRole('button', { name: '시트로 보기' }).first();
  if (await sheetButton.count()) {
    await spotlight(page, sheetButton, 'grid', 3000, { padding: 12 });
    await sheetButton.click().catch(() => {});
    await page.waitForTimeout(900);
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
      await spotlight(page, dialog, 'grid', 3000, { padding: 10, radius: 22 });
      const cell = page.locator('td[title*="7행 D열"]').first();
      if (await cell.isVisible({ timeout: 3000 }).catch(() => false)) {
        await spotlight(page, cell, 'target', 3000, { padding: 14, radius: 12 });
        await cell.click().catch(() => {});
        await page.getByText(/수정 전|변경 셀 상세|현재 최신본 값/).first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
        const cellDetail = page.locator('aside').filter({ hasText: '현재 최신본 값' }).first();
        const currentValue = cellDetail.locator('p').filter({ hasText: '현재 최신본 값' }).first();
        if (await currentValue.isVisible({ timeout: 1200 }).catch(() => false)) {
          await spotlight(page, currentValue, 'check', 3000, { padding: 16, radius: 14 });
        }
        const modalBody = page.getByRole('dialog', { name: 'Excel 시트 보기' }).locator('.overflow-y-auto').first();
        await smoothWheelAt(page, modalBody, 520, 9, 70, { x: 22, y: 680 });
        const history = cellDetail.locator('div.rounded-lg').filter({ hasText: '수정 전' }).first();
        if (await history.isVisible({ timeout: 1600 }).catch(() => false)) {
          await spotlight(page, history, 'delta', 3000, { padding: 16, radius: 14 });
        }
      }
    } else {
      await page.waitForTimeout(900);
    }
  }
}

async function captureDuplicates(page) {
  await clickNav(page, '중복');
  await page.getByText('같은 내용 문서').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText('같은 내용').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(900);
  const filter = page.getByPlaceholder('파일명 또는 폴더명으로 현재 묶음 안에서 찾기');
  await filter.pressSequentially('공통', { delay: 150 });
  await page.waitForTimeout(1200);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(DOCS_ASSETS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.join(ARTIFACT_ROOT, stamp);
  const libraryDir = path.join(os.tmpdir(), 'OfficeWhere_README_Demo_Library');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-readme-demo-data-'));
  const backendPort = await getFreePort();
  const frontendPort = await getFreePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const viteUrl = `http://127.0.0.1:${frontendPort}`;
  await fs.mkdir(workDir, { recursive: true });
  await copyLibrary(libraryDir);

  const python = path.join(ROOT, 'venv', 'bin', 'python');
  const backend = startProcess(python, [
    path.join(ROOT, 'backend_server.py'),
    '--host', '127.0.0.1',
    '--port', String(backendPort),
    '--data-dir', dataDir,
    '--log-level', 'warning',
  ]);
  let vite;
  let browser;
  try {
    await waitForHttp(`${backendUrl}/api/health`, 90_000);
    await prepareLibrary(backendUrl, libraryDir);

    vite = startProcess(path.join(FRONTEND, 'node_modules', '.bin', 'vite'), [
      '--host', '127.0.0.1',
      '--port', String(frontendPort),
    ], {
      cwd: FRONTEND,
      env: {
        VITE_BACKEND_URL: backendUrl,
        HOST: '127.0.0.1',
        VITE_PORT: String(frontendPort),
        BACKEND_PORT: String(backendPort),
      },
    });
    await waitForHttp(viteUrl, 90_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
      env: runtimeEnv(),
    });

    const clips = [];
    const stills = [];
    clips.push(await startClip(browser, viteUrl, workDir, 'search', libraryDir, captureSearch, args));
    clips.push(await startClip(browser, viteUrl, workDir, 'version', libraryDir, captureVersion, args));
    stills.push(await captureStill(browser, viteUrl, workDir, 'duplicates', libraryDir, captureDuplicates));

    const report = {
      created_at: new Date().toISOString(),
      viewport: VIEWPORT,
      backend_url: backendUrl,
      vite_url: viteUrl,
      clips,
      stills,
    };
    const reportPath = path.join(workDir, 'recording-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    await new Promise((resolve, reject) => {
      const child = spawn(python, [
        path.join(ROOT, 'scripts', 'validate_readme_demos.py'),
        '--media-report', reportPath,
        '--max-width', String(CAPTURE_LIMITS.maxWidth),
        '--max-height', String(CAPTURE_LIMITS.maxHeight),
        '--max-duration-ms', String(CAPTURE_LIMITS.maxDurationMs),
        '--max-bytes', String(CAPTURE_LIMITS.maxBytes),
        '--json',
      ], { cwd: ROOT, env: runtimeEnv(), stdio: 'inherit' });
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`validator exited ${code}`)));
      child.on('error', reject);
    });
    console.log(`Saved README demo media to ${path.relative(ROOT, DOCS_ASSETS)}`);
    console.log(`Capture artifacts: ${path.relative(ROOT, workDir)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopProcess(vite);
    await stopProcess(backend);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(libraryDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
