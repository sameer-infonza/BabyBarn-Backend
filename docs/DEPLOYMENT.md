# BabyBarn-Backend — deployment

| Item | Value |
|------|-------|
| EC2 path | `/var/www/BabyBarn-Backend` |
| Port | **5000** |
| PM2 | `babybarn-api` |

```bash
bash deploy/deploy-backend.sh
bash deploy/rollback.sh
bash deploy/server-bootstrap.sh   # one-time Ubuntu setup
```

Health check: `curl http://127.0.0.1:5000/health`

See monorepo `docs/DEPLOYMENT.md` for full workflow.
