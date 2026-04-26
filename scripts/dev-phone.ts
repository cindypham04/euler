/**
 * Start the Next dev server and a Cloudflare Quick Tunnel so a phone can hit
 * /capture without firewall, HTTPS-cert, or LAN-IP fuss. The tunnel URL is
 * exposed to Next via EULER_PUBLIC_URL so the /capture page can render a QR
 * for it.
 *
 * Usage:
 *   npm run dev:phone
 *
 * The `cloudflared` npm package bundles the cloudflared binary (downloaded on
 * `npm install`). No signup, no auth, no interstitial. The URL stays stable
 * for the entire session.
 *
 * On Ctrl+C: closes the tunnel and stops the dev server.
 */

import { spawn, type ChildProcess } from 'child_process';
import { Tunnel } from 'cloudflared';
import qrcode from 'qrcode-terminal';

const PORT = 3000;

function startTunnel(port: number): Promise<{ url: string; tunnel: Tunnel }> {
  return new Promise((resolve, reject) => {
    const tunnel = Tunnel.quick(`http://localhost:${port}`);
    let resolved = false;

    tunnel.on('url', (url) => {
      if (resolved) return;
      resolved = true;
      resolve({ url, tunnel });
    });

    tunnel.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      reject(err);
    });

    tunnel.on('exit', (code) => {
      if (resolved) return;
      resolved = true;
      reject(
        new Error(
          `cloudflared exited with code ${code} before producing a URL.`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  console.log(`Opening Cloudflare Quick Tunnel for port ${PORT}…`);
  let url: string;
  let tunnel: Tunnel;
  try {
    ({ url, tunnel } = await startTunnel(PORT));
  } catch (err) {
    console.error('Failed to open tunnel:', err);
    process.exit(1);
  }
  console.log(`\nTunnel ready: ${url}`);

  const captureUrl = `${url.replace(/\/$/, '')}/capture`;

  console.log(`\nStarting Next dev server on port ${PORT}…\n`);
  const nextChild: ChildProcess = spawn(
    'npx',
    ['next', 'dev', '-p', String(PORT)],
    {
      stdio: 'inherit',
      env: { ...process.env, EULER_PUBLIC_URL: url },
      shell: true,
    },
  );

  setTimeout(() => {
    console.log(`\nOpen on phone: ${captureUrl}\n`);
    qrcode.generate(captureUrl, { small: true });
  }, 2500);

  let cleaningUp = false;
  function cleanup(code: number): void {
    if (cleaningUp) return;
    cleaningUp = true;
    try {
      tunnel.stop();
    } catch {
      // ignore
    }
    if (!nextChild.killed) nextChild.kill();
    process.exit(code);
  }

  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));
  nextChild.on('exit', (code) => cleanup(code ?? 0));
  tunnel.on('exit', (code) => {
    console.log(`\nTunnel closed (exit code ${code}).`);
    cleanup(0);
  });
}

main().catch((err) => {
  console.error('dev:phone failed:', err);
  process.exit(1);
});
