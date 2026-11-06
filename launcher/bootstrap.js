// Only the launcher's child process receives this file through NODE_OPTIONS.
const fs = require('fs');
if (process.env.SCORING_PID_FILE) {
  fs.writeFileSync(process.env.SCORING_PID_FILE, String(process.pid));
  delete process.env.SCORING_PID_FILE;
}
