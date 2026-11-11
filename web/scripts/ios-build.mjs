import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Resolve public Swift packages without opening Keychain or reading stored credentials.
if (['.netrc', '_netrc'].some((name) => existsSync(join(homedir(), name)))) {
  throw new Error('A netrc credential file exists. Build in Xcode using your preferred authentication settings.')
}
const env = {
  ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
  GIT_TERMINAL_PROMPT: '0',
}
const result = spawnSync('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
  '-sdk', 'iphonesimulator', '-derivedDataPath', 'ios/DerivedData',
  '-scmProvider', 'system', '-packageAuthorizationProvider', 'netrc',
  'CODE_SIGNING_ALLOWED=NO', 'build',
], { env, stdio: 'inherit' })
process.exit(result.status ?? 1)
