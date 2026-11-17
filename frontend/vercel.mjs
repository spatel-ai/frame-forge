// Vercel configuration (replaces vercel.json). Vercel runs this file at build time.
//
// The browser always calls `/api/...` on the site's own address, and Vercel forwards those
// requests to the backend, so the login cookie stays same-site.
//
// Backend address: DEFAULT_API_TARGET below, which needs no setting in Vercel. To use another
// backend (for example a staging server), set API_TARGET in Vercel (Project > Settings >
// Environment Variables, Type "Config", not "Secret") and redeploy. The address is public anyway:
// it is in the domain's DNS. Local development uses frontend/.env (vite.config.ts).
const DEFAULT_API_TARGET = 'https://api.sptel.in'

const target = (process.env.API_TARGET || DEFAULT_API_TARGET).trim().replace(/\/+$/, '')

if (!/^https:\/\/[^/\s]+$/.test(target)) {
  throw new Error(
    `API_TARGET must be an https address such as https://api.example.com (got "${target}").`,
  )
}

// Shown in the build log, so a wrong address is easy to spot.
console.log(`[vercel.mjs] API_TARGET = ${target}`)

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${target}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
}
