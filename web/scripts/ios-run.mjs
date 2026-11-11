import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const app = 'ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app'
if (!existsSync(app)) throw new Error('Run npm run ios:prepare, then npm run ios:build first.')
const target = process.env.IOS_SIMULATOR_UDID || 'booted'
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' }
for (const args of [
  ['simctl', 'install', target, app],
  ['simctl', 'launch', target, 'com.domyshev.health'],
]) {
  const result = spawnSync('xcrun', args, { stdio: 'inherit', env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
