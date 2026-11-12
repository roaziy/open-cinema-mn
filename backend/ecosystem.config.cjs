// pm2 process file. Run from anywhere: `pm2 start backend/ecosystem.config.cjs`.
// Configuration comes from the `backend/.env` on the server (node loads it, see node_args);
// values already present in the process environment win over the file.
module.exports = {
  apps: [
    {
      name: 'open-cinema-api',
      cwd: __dirname,
      script: 'dist/index.js',
      node_args: '--enable-source-maps --env-file-if-exists=.env',
      // The live seat hub (SSE) keeps its state in memory, so there must be exactly one process.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      // Must exceed the API's hard exit (provider timeout + 8 s = 28 s, see src/index.ts).
      kill_timeout: 30000,
      env: { NODE_ENV: 'production' },
      out_file: 'logs/api-out.log',
      error_file: 'logs/api-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
