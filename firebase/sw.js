const CACHE_NAME = 'travel-pro-firebase-v12'; // 1. 版號 +1
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/vue@3/dist/vue.global.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      // 清除舊版本快取
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      }),
      // 讓新 SW 立即控制所有開啟的頁面
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // 2. 針對頁面導向 (HTML) 或帶有 trip 參數的請求：強制走網路，且絕不拿 HTTP 舊快取
  if (e.request.mode === 'navigate' || url.searchParams.has('trip')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }) // 強制瀏覽器向 GitHub 伺服器發起 Revalidate
        .then((response) => {
          // 聯網成功，把最新畫面備份一份到 Cache Storage
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
          return response;
        })
        .catch(() => {
          // 完全斷網時，才退回到離線快取中的 index.html
          return caches.match('./index.html');
        })
    );
    return;
  }

  // 3. 其他靜態資源 (Tailwind, Vue, CSS, JS) 保持原有的 Network First
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
