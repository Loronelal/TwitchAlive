import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9222';

export async function targets() {
  const r = await fetch(BASE + '/json/list');
  return r.json();
}

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    const events = [];
    const listeners = [];
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const msgId = ++id;
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return new Promise((res, rej) => pending.set(msgId, { res, rej }));
      },
      on(fn) { listeners.push(fn); },
      events,
      close() { ws.close(); }
    });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        events.push(msg);
        listeners.forEach((fn) => fn(msg));
      }
    };
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && /twitch\.tv/.test(t.url));
  if (!page) { console.log('no twitch page target'); return; }
  console.log('target:', page.url, '|', page.title);

  const c = await connect(page.webSocketDebuggerUrl);
  const logs = [];
  c.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`[${m.params.type}] ${args}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    }
  });

  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await sleep(1500);

  const contexts = c.events
    .filter((m) => m.method === 'Runtime.executionContextCreated')
    .map((m) => m.params.context);
  console.log('\ncontexts:');
  for (const ctx of contexts) {
    console.log(`  id=${ctx.id} origin=${ctx.origin} name=${JSON.stringify(ctx.name)} default=${ctx.auxData?.isDefault} type=${ctx.auxData?.type}`);
  }

  const pageCtx = contexts.find((x) => x.auxData?.isDefault) || contexts[0];
  const expr = `({ href: location.href, title: document.title, headers: document.querySelectorAll('.accordion-header').length, campaigns: document.querySelectorAll('.inventory-campaign-info').length, stars: document.querySelectorAll('.tak-fav-star').length, fav: typeof globalThis.__twitchAliveFav })`;
  if (pageCtx) {
    try {
      const r = await c.send('Runtime.evaluate', { expression: expr, contextId: pageCtx.id, returnByValue: true });
      console.log('\nmain world:', JSON.stringify(r.result?.value ?? r.result));
    } catch (e) { console.log('main eval failed:', e.message); }
  }

  for (const ctx of contexts.filter((x) => /^chrome-extension:\/\//.test(x.origin || ''))) {
    try {
      const r = await c.send('Runtime.evaluate', { expression: expr, contextId: ctx.id, returnByValue: true });
      console.log(`\next world ${ctx.origin}:`, JSON.stringify(r.result?.value ?? r.result));
    } catch (e) { console.log('ext eval failed:', e.message); }
  }

  console.log('\nconsole/log events:');
  for (const line of logs.slice(-40)) console.log('  ' + line);

  c.close();
  fs.writeFileSync('C:/Users/Мы/Desktop/TwitchAlive/dumps/cdp-out.txt', 'ok');
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
