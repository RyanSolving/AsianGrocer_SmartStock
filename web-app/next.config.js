/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https?:\/\/.*\/api\/catalog/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'catalog-cache',
        expiration: {
          maxAgeSeconds: 86400, // 24 hours
        },
      },
    },
  ],
})

module.exports = withPWA({
  // Concurrent local previews must not overwrite each other's client bundles.
  distDir: process.env.NODE_ENV === 'development' ? `.next-dev-${process.env.PORT || 3000}` : '.next',
  reactStrictMode: true,
})
