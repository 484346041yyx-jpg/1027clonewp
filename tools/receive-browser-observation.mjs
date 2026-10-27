import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '');
if (!path.isAbsolute(process.argv[2] ?? '') || !directory.toLowerCase().startsWith('d:\\clonewp\\references\\')) throw new Error('A reference observation directory inside D:/cloneWP is required');
await mkdir(directory, { recursive: true });
const token = randomBytes(24).toString('hex');
const names = /^(?:desktop|tablet|mobile)(?:-full|-raw)?\.(?:jpg|json|html)$/;
const server = createServer(async (request, response) => {
  const name = decodeURIComponent((request.url ?? '').replace(/^\//, ''));
  if (request.headers['x-observation-token'] !== token) { response.writeHead(403).end(); return; }
  if (request.method === 'GET' && name === 'collector') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(await readFile('D:/cloneWP/src/reference/collect-blocks.browser.js'));
    return;
  }
  if (request.method !== 'POST' || !names.test(name)) { response.writeHead(403).end(); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 25_000_000) throw new Error('Observation exceeds byte limit'); chunks.push(chunk); }
    if (!size) throw new Error('Empty observation');
    await writeFile(path.join(directory, name), Buffer.concat(chunks));
    response.writeHead(201).end('saved');
  } catch { response.writeHead(400).end('invalid observation'); }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener address');
  process.stdout.write(JSON.stringify({ port: address.port, token }) + '\n');
});
