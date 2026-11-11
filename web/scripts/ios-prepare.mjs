import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const development = process.argv.includes('--development')
const base = process.env.VITE_NATIVE_API_URL || (development ? 'http://127.0.0.1:8080' : 'https://health.domyshev.com')
function parseOrigin(value) {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:'))) {
    throw new Error('Use a clean HTTPS origin. Development permits loopback HTTP only.')
  }
  return url.origin
}
const apiURL = parseOrigin(base)
const mode = development ? 'native-development' : 'production'
const env = { ...process.env, VITE_NATIVE_API_URL: apiURL,
  VITE_NATIVE_REQUEST_ORIGIN: parseOrigin(process.env.VITE_NATIVE_REQUEST_ORIGIN || (development ? 'http://127.0.0.1:5173' : apiURL)) }
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b'])
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode])
writeFileSync('dist/native-build.json', JSON.stringify({ mode, apiURL }))
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'ios'])
console.log(`Prepared ${mode} iPhone app for ${apiURL}.`)
