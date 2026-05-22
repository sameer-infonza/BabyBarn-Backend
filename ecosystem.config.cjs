/**
 * PM2 — Baby Barn API (port 5000)
 * Use .cjs because package.json has "type": "module" (PM2 requires CommonJS config).
 */
module.exports = {
  apps: [
    {
      name: "babybarn-api",
      cwd: __dirname,
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env_production: {
        NODE_ENV: "production",
        PORT: "5000",
      },
    },
  ],
};
