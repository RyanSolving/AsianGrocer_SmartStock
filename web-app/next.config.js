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
  reactStrictMode: true,
})
