/*
 * sw.js — RM Gestor
 * - Arquivos do próprio app: REDE PRIMEIRO (sempre pega a versão nova do GitHub);
 *   se estiver sem internet (ou a rede travar), usa a cópia guardada.
 * - versao.json: nunca é guardado nem interceptado (o controle remoto precisa do dado fresco).
 * - Fotos dos produtos (OpenFoodFacts, BeepScan): guardadas no aparelho na primeira vez
 *   que aparecem e mostradas mesmo sem internet. Ficam num cache separado.
 * - Bibliotecas dos CDNs (xlsx-populate, html5-qrcode, zxing): cache primeiro, para funcionar offline.
 * - Chamadas a outros sites (BeepScan, OpenFoodFacts, Google Sheets): passam direto.
 */
const CACHE = 'rm-gestor-v2';
const IMG_CACHE = 'rm-gestor-fotos-v1'; // não é apagado nas atualizações do app
const MAX_FOTOS = 200;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];
const IMG_HOSTS = ['images.openfoodfacts.org', 'static.openfoodfacts.org', 'beep-images.bgpworks.com'];
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'app-control.js',
  'icon-192x192.png',
  'icon-512x512.png',
  'PERDAS E TROCA.xlsx',
  'planilha_padrao_original.xlsx'
];
const TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/versao.json')) return; // direto na rede
    event.respondWith(redePrimeiro(req));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cachePrimeiro(req));
    return;
  }

  if (req.destination === 'image' || IMG_HOSTS.includes(url.hostname)) {
    event.respondWith(fotoCacheada(req));
  }
  // qualquer outro site: não intercepta
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req, { ignoreSearch: true });

  try {
    const resp = await buscar(req, guardado ? TIMEOUT_MS : 0);
    if (resp && resp.status === 200 && !resp.redirected) {
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const pagina = (await cache.match('index.html')) || (await cache.match('./'));
      if (pagina) return pagina;
    }
    throw e;
  }
}

function buscar(req, timeoutMs) {
  if (!timeoutMs) return fetch(req, { cache: 'no-cache' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(req, { cache: 'no-cache', signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function cachePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const resp = await fetch(req);
  if (resp && (resp.status === 200 || resp.type === 'opaque')) {
    cache.put(req, resp.clone()).catch(() => {});
  }
  return resp;
}

// Fotos: se já está guardada, usa na hora (funciona offline); senão baixa e guarda.
async function fotoCacheada(req) {
  const cache = await caches.open(IMG_CACHE);
  const guardada = await cache.match(req.url);
  if (guardada) return guardada;

  let resp;
  try {
    // Tenta com CORS: dá para conferir se a foto veio certa antes de guardar.
    resp = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    // Servidor sem CORS: busca como imagem comum (resposta "opaca", também pode ser guardada).
    resp = await fetch(req.url, { mode: 'no-cors', credentials: 'omit' });
  }

  if (resp && (resp.status === 200 || resp.type === 'opaque')) {
    await cache.put(req.url, resp.clone()).catch(() => {});
    limitarFotos(cache);
  }
  return resp;
}

// Mantém no máximo MAX_FOTOS, apagando as mais antigas.
async function limitarFotos(cache) {
  const chaves = await cache.keys();
  const excesso = chaves.length - MAX_FOTOS;
  for (let i = 0; i < excesso; i++) await cache.delete(chaves[i]);
}
