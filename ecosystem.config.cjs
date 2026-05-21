/** PM2 process config — install on EC2: npm i -g pm2 */
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
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
