// Stand-in for `vp dev` in the listener probes. Opens real sockets on port 5199 as FAKE_VP_MODE says.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import type { Server } from 'node:http';
import type { ListenOptions } from 'node:net';
import path from 'node:path';

const mode = process.env.FAKE_VP_MODE;
const PORT = 5199;
const listen = (host: string, options: Partial<ListenOptions> & { ipv6Only?: boolean } = {}, onRequest: (server: Server) => void = () => {}): Promise<Server> => new Promise((resolve) => {
  const server: Server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>probe</body></html>');
    onRequest(server);
  });
  server.listen({ port: PORT, host, ...options }, () => resolve(server));
});
const swap = (server: Server, next?: () => Promise<unknown>) => setTimeout(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (next) await next();
}, 100);
const announce = () => console.log('  Local:   http://127.0.0.1:5199/');
const spawnChild = (childMode: string, detached: boolean): Promise<ChildProcess> => new Promise((resolve) => {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], {
    env: { ...process.env, FAKE_VP_MODE: childMode }, stdio: ['ignore', 'pipe', 'inherit'], detached,
  });
  child.stdout.once('data', () => resolve(child));
});

if (mode === 'owned' || mode === 'lsof-fail' || mode === 'ps-fail') {
  await listen('127.0.0.1');
  announce();
} else if (mode === 'ipv6-only') {
  // IPv4 answers the readiness fetch, then only IPv6 is left.
  const server = await listen('127.0.0.1', {}, (current) => swap(current, () => listen('::1', { ipv6Only: true })));
  announce();
} else if (mode === 'none') {
  await listen('127.0.0.1', {}, (current) => swap(current));
  announce();
} else if (mode === 'two-same-group') {
  await spawnChild('second', false); // same process group as this process
  await listen('127.0.0.1');
  announce();
} else if (mode === 'second') {
  // macOS has no SO_REUSEPORT in Node (ENOTSUP), so the second same-group listener uses the other IP family.
  await listen('::1', { ipv6Only: true });
  console.log('second listener ready');
} else if (mode === 'foreign-group') {
  const child = await spawnChild('foreign', true); // own session, so its own process group
  writeFileSync(path.join(process.env.FAKE_VP_DIR!, 'foreign.pid'), String(child.pid));
  announce();
} else if (mode === 'foreign') {
  await listen('127.0.0.1');
  console.log('foreign listener ready');
} else {
  throw new Error(`unknown FAKE_VP_MODE ${mode}`);
}
setInterval(() => {}, 1 << 30);
