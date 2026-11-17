// Vercel configuration (replaces vercel.json). Vercel runs this file at build time, so the
// backend address comes from an environment variable instead of being written in the repo:
//
//   API_TARGET=https://api.example.com
//
// Set it in Vercel (Project > Settings > Environment Variables) for Production and Preview, and in
// frontend/.env for local development (vite.config.ts reads the same name). Change the variable
// and redeploy; no file needs editing. The browser always calls `/api/...` on the site's own
// address, and Vercel forwards those requests to API_TARGET, so the login cookie stays same-site.
const target = (process.env.API_TARGET ?? '').trim().replace(/\/+$/, '')

if (!/^https:\/\/[^/\s]+$/.test(target)) {
  throw new Error(
    'API_TARGET is missing or not an https address. Set it in Vercel > Project > Settings > ' +
      'Environment Variables, for example API_TARGET=https://api.example.com, then redeploy.',
  )
}

// Shown in the build log, and sent as a response header on every page, so a wrong address is easy
// to spot (the API address is public anyway: it is in the site's DNS).
console.log(`[vercel.mjs] API_TARGET = ${target}`)

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  headers: [{ source: '/(.*)', headers: [{ key: 'x-api-target', value: target }] }],
  rewrites: [
    { source: '/api/:path*', destination: `${target}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
}
