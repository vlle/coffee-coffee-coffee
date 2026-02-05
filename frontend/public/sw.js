const VERSION = 'v1'
const STATIC_CACHE = `coffee-log-static-${VERSION}`
const RUNTIME_CACHE = `coffee-log-runtime-${VERSION}`

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

const networkFirst = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      cacheFirst(request, STATIC_CACHE).catch(() => caches.match('/index.html'))
    )
    return
  }

  if (['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE))
    return
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)))
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Coffee Log'
  const options = {
    body: data.body || 'Open your journal.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      url: data.url || '/',
    },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(target) && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target)
      }
      return undefined
    })
  )
})
