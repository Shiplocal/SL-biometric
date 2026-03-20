// cleanup.js — kills stale lsnode/biometric-app processes on startup
// Called automatically from app.js on boot

const { execSync } = require('child_process');

function cleanupStaleProcesses() {
  try {
    const myPid = process.pid;
    const appDir = __dirname;

    // Get all lsnode processes for this app
    const result = execSync('ps aux', { encoding: 'utf8' });
    const lines = result.split('\n').filter(l =>
      l.includes('lsnode') &&
      l.includes('biometric-app') &&
      !l.includes('grep')
    );

    let killed = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1]);
      if (!pid || pid === myPid) continue;
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        console.log(`[cleanup] Killed stale process PID ${pid}`);
      } catch(e) {
        // Process already gone or no permission — ignore
      }
    }
    if (killed > 0) {
      console.log(`[cleanup] Killed ${killed} stale lsnode process(es)`);
    } else {
      console.log('[cleanup] No stale processes found');
    }
  } catch(e) {
    // Non-fatal — cleanup failure should never stop the app from starting
    console.warn('[cleanup] Could not check for stale processes:', e.message);
  }
}

module.exports = { cleanupStaleProcesses };