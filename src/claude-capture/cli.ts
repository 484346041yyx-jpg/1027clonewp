import { readFile, stat } from 'node:fs/promises';
import { assertWorkspaceAccess } from '../workspace/service.js';
import path from 'node:path';
import { z } from 'zod';
import { assertPublicUrl } from '../capture/url-safety.js';
import { readNative44BrowserObservation } from '../native44/source.js';
import { observeWithClaudeBrowser } from './observe.js';
import { exportSourceAssetsWithClaudeBrowser } from './assets.js';
import { exportSourceFontsWithClaudeBrowser } from './fonts.js';
import { observeHoverWithClaudeBrowser } from './hover.js';
import { observePhonesWithClaudeBrowser } from './phones.js';
import { openClaudeBrowser } from './session.js';

const project = 'D:/cloneWP';
const regionsSchema = z.array(z.object({ id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/), selector: z.string().min(1), role: z.enum(['header', 'footer', 'region']).optional(), previousSelector: z.string().min(1).optional() }).strict()).min(1).max(60);
const usage = 'Usage: npm run claude:capture -- inspect --url URL | observe --url URL --task TASK_ID --regions FILE [--out DIR] [--headed] | phones --url URL --task TASK_ID --regions FILE [--out DIR] [--viewports 390x844,430x932] [--headed] | hover --url URL --observed DIR [--per-rule 3] [--headed] | assets --url URL --observed DIR | fonts --url URL --observed DIR';

function parse(args: string[]) {
  const flags = new Map<string, string | true>(), positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (!item.startsWith('--')) { positional.push(item); continue; }
    const name = item.slice(2);
    if (name === 'headed') flags.set(name, true);
    else { const value = args[++index]; if (!value || value.startsWith('--')) throw Error(`Missing value for --${name}`); flags.set(name, value); }
  }
  return { command: positional[0], flags };
}

const detectRegions = `(() => {
  const visible = element => { const css = getComputedStyle(element), box = element.getBoundingClientRect(); return css.display !== 'none' && css.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
  const candidates = [...document.querySelectorAll('header, footer, main > *, [role="banner"], [role="contentinfo"], [id^="shopify-section-"], body > section, body > div > section')].filter(element => visible(element) && element.getBoundingClientRect().height >= 24);
  const outer = candidates.filter(element => !candidates.some(other => other !== element && other.contains(element)));
  return outer.map(element => { const box = element.getBoundingClientRect(); return { selector: sceneSelectorV2(element), tag: element.tagName.toLowerCase(), id: element.id || null, y: Math.round(box.y + scrollY), height: Math.round(box.height), position: getComputedStyle(element).position, text: element.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90) }; }).sort((a, b) => a.y - b.y);
})()`;

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  const url = flags.get('url') as string | undefined;
  if (!command || !url) { console.error(usage); process.exitCode = 2; return; }
  await assertPublicUrl(url);
  if (command !== 'inspect') await assertWorkspaceAccess(project);
  if (command === 'inspect') {
    const session = await openClaudeBrowser({ viewport: { width: 1920, height: 1080 } });
    try {
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await session.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
      await session.page.evaluate('claudeCaptureWarmupV2()');
      console.log(JSON.stringify({ url: session.page.url(), title: await session.page.title(), regions: await session.page.evaluate(detectRegions), carousels: await session.page.evaluate('claudeCaptureCarouselOwnersV2()') }, null, 2));
    } finally { await session.close(); }
    return;
  }
  if (command === 'observe') {
    const task = flags.get('task') as string | undefined, regionsFile = flags.get('regions') as string | undefined;
    if (!task || !/^[a-zA-Z][a-zA-Z0-9_-]{1,90}$/.test(task) || !regionsFile) { console.error(usage); process.exitCode = 2; return; }
    const out = path.resolve(String(flags.get('out') ?? path.join(project, 'references', task))), root = path.resolve(project), relative = path.relative(root, out);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The observation directory must stay inside D:/cloneWP');
    if (await stat(path.join(out, 'observation-manifest.json')).then(() => true, () => false)) throw Error('An observation already exists in this directory; use a new task directory');
    const regions = regionsSchema.parse(JSON.parse(await readFile(regionsFile, 'utf8')));
    const result = await observeWithClaudeBrowser({ url, outDir: out, prefix: task.split('-')[0], regions, headless: flags.get('headed') ? false : undefined, log: message => console.error(message) });
    const binding = await readNative44BrowserObservation(out, url);
    console.log(JSON.stringify({ status: 'imported-ready', directory: out, sidecarVersion: binding?.version, tool: binding?.browserObservation.tool, method: binding?.browserObservation.method, snapshots: result.snapshots.map(item => ({ id: item.snapshotId, packets: item.packetFiles.length, screenshot: item.screenshotPath })) }, null, 2));
    return;
  }
  if (command === 'phones') {
    const task = flags.get('task') as string | undefined, regionsFile = flags.get('regions') as string | undefined;
    if (!task || !/^[a-zA-Z][a-zA-Z0-9_-]{1,90}$/.test(task) || !regionsFile) { console.error(usage); process.exitCode = 2; return; }
    const out = path.resolve(String(flags.get('out') ?? path.join(project, 'references', task))), root = path.resolve(project), relative = path.relative(root, out);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The observation directory must stay inside D:/cloneWP');
    if (await stat(path.join(out, 'responsive-source.json')).then(() => true, () => false)) throw Error('A phone source already exists in this directory');
    const viewports = flags.has('viewports') ? String(flags.get('viewports')).split(',').map(item => { const match = /^(\d{3,4})x(\d{3,4})$/.exec(item.trim()); if (!match) throw Error('Invalid --viewports item'); return { width: Number(match[1]), height: Number(match[2]) }; }) : undefined;
    const regions = regionsSchema.parse(JSON.parse(await readFile(regionsFile, 'utf8')));
    const result = await observePhonesWithClaudeBrowser({ url, outDir: out, prefix: task.split('-')[0], taskId: task, regions, viewports, ...(flags.has('header-region') ? { header: { regionId: String(flags.get('header-region')), firstBodySelector: String(flags.get('first-body') ?? 'body > div.gardensun-video-section'), ...(flags.has('menu-toggle') ? { menuToggle: String(flags.get('menu-toggle')) } : {}), ...(flags.has('logo-selector') ? { logoSelector: String(flags.get('logo-selector')) } : {}) } } : {}), headless: flags.get('headed') ? false : undefined, log: message => console.error(message) });
    console.log(JSON.stringify({ status: 'phone-source-ready', source: result.sourcePath, snapshots: result.snapshots }, null, 2));
    return;
  }
  if (command === 'hover') {
    const observed = flags.get('observed') as string | undefined;
    if (!observed) { console.error(usage); process.exitCode = 2; return; }
    const directory = path.resolve(observed), relative = path.relative(path.resolve(project), directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The observation directory must stay inside D:/cloneWP');
    const result = await observeHoverWithClaudeBrowser({ url, observedDir: directory, perRule: flags.has('per-rule') ? Number(flags.get('per-rule')) : undefined, headless: flags.get('headed') ? false : undefined, log: message => console.error(message) });
    console.log(JSON.stringify({ status: 'hover-review-ready', ...result }, null, 2));
    return;
  }
  if (command === 'assets') {
    const observed = flags.get('observed') as string | undefined;
    if (!observed) { console.error(usage); process.exitCode = 2; return; }
    const directory = path.resolve(observed), relative = path.relative(path.resolve(project), directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The observation directory must stay inside D:/cloneWP');
    const manifest = JSON.parse(await readFile(path.join(directory, 'observation-manifest.json'), 'utf8')) as { packets: Array<{ path: string }> };
    const phone = await readFile(path.join(directory, 'responsive-source.json'), 'utf8').then(text => (JSON.parse(text) as { packets: Array<{ path: string }> }).packets, () => []);
    const result = await exportSourceAssetsWithClaudeBrowser({ url, directory, packetFiles: [...manifest.packets, ...phone].map(item => item.path), log: message => console.error(message) });
    console.log(JSON.stringify({ status: 'assets-ready', ...result }, null, 2));
    return;
  }
  if (command === 'fonts') {
    const observed = flags.get('observed') as string | undefined;
    if (!observed) { console.error(usage); process.exitCode = 2; return; }
    const directory = path.resolve(observed), relative = path.relative(path.resolve(project), directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The observation directory must stay inside D:/cloneWP');
    const receipt = await exportSourceFontsWithClaudeBrowser({ url, directory, log: message => console.error(message) });
    console.log(JSON.stringify({ status: 'fonts-ready', loadedFamilies: receipt.loadedFamilies, fonts: receipt.fonts.map(font => ({ file: font.file, url: font.url, bytes: font.bytes })) }, null, 2));
    return;
  }
  console.error(usage); process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
