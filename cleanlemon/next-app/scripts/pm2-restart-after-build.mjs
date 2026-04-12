#!/usr/bin/env node
/**
 * After `next build`, `next start` still serves a static allowlist from process start → new chunks 404 until PM2 restart.
 * Enable on ECS with either:
 *   - RESTART_PM2_AFTER_NEXT_BUILD=1 (or true), or
 *   - touch cleanlemon/next-app/.enable-pm2-restart-after-build (gitignored marker)
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

const v = (process.env.RESTART_PM2_AFTER_NEXT_BUILD || '').toLowerCase()
const envOn = v === '1' || v === 'true' || v === 'yes'
const dir = dirname(fileURLToPath(import.meta.url))
const marker = join(dir, '..', '.enable-pm2-restart-after-build')
const markerOn = existsSync(marker)

if (!envOn && !markerOn) {
  process.exit(0)
}

function restart(name) {
  try {
    execSync(`pm2 restart ${name}`, { stdio: 'inherit' })
  } catch {
    console.warn(`[cleanlemons-next post-build] pm2 restart ${name} skipped (not in PM2?)`)
  }
}

console.log('[cleanlemons-next post-build] RESTART_PM2_AFTER_NEXT_BUILD / marker enabled → restarting Next PM2 apps…')
restart('next-cleanlemons')
try {
  execSync('pm2 describe next-cleanlemons-3000', { stdio: 'ignore' })
  restart('next-cleanlemons-3000')
} catch {
  /* optional second app */
}
