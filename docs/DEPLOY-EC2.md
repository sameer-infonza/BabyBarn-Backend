# Deploy backend to AWS EC2 (GitHub Actions)

## 1. One-time EC2 setup

```bash
# On the EC2 instance (Ubuntu)
sudo apt update && sudo apt install -y git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

cd ~
git clone https://github.com/sameer-infonza/BabyBarn-Backend.git
cd BabyBarn-Backend
cp .env.example .env   # edit with production DATABASE_URL, Stripe, SMTP, etc.
npm ci
npx prisma migrate deploy
pm2 start ecosystem.config.cjs --env production
pm2 startup
pm2 save
```

Open security group ports: **22** (SSH), **5000** (API), **3000** / **3001** (frontends on same host if applicable).

## 2. GitHub repository secrets

In **Settings → Secrets and variables → Actions**, add:

| Secret | Example | Required |
|--------|---------|----------|
| `EC2_HOST` | `13.218.44.12` or your Elastic IP | Yes |
| `EC2_USER` | `ubuntu` or `ec2-user` | Yes |
| `EC2_SSH_PRIVATE_KEY` | Full contents of `.pem` key | Yes |
| `EC2_SSH_PORT` | `22` | No |
| `EC2_DEPLOY_PATH` | `/home/ubuntu/BabyBarn-Backend` | No (defaults to `~/BabyBarn-Backend`) |

Never commit `.env` or PEM keys to Git.

## 3. What runs on each push to `master`

Workflow [`.github/workflows/deploy-ec2.yml`](../.github/workflows/deploy-ec2.yml):

1. **CI** — `npm ci` + `prisma generate`
2. **Deploy** — SSH to EC2, run [`scripts/deploy-ec2.sh`](../scripts/deploy-ec2.sh):
   - `git fetch` + `git reset --hard origin/master` (no pull)
   - `npm ci`, `prisma migrate deploy`
   - `pm2 restart babybarn-api`

Trigger manually: **Actions → Deploy to EC2 → Run workflow**.

## 4. Health check

```bash
curl -s http://127.0.0.1:5000/health
# or your public IP: curl http://13.218.44.12:5000/health
```
