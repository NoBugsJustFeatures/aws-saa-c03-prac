# AWS SAA-C03 Practice Web (Local Full-Stack)

Simple modern full-stack website to practice AWS SAA-C03 from markdown files in `../practices`.

## Features
- Dashboard that lists all markdown documents from `aws-saa-prac/practices`
- Click any doc to read it in the web UI
- Dedicated `S-practice-exam.md` practice exam flow
- Exact SAA-C03 countdown timer: **130 minutes (02:10:00)**
- Auto-submit at timer end and score using AWS scale (1000-point, pass at 720)

## 1) Install and run

```bash
cd /home/vu/projects/aws-saa-prac/practice-web
npm install
npm start
```

Server runs on `http://localhost:3000`.

## 2) Deploy with Docker Compose (standalone for this app)

```bash
cd /home/vu/projects/aws-saa-prac/practice-web
docker compose up -d --build
```

For later updates, run the same command again from this folder.

Stop:

```bash
docker compose down
```

Open:

- `http://localhost:3000`

## 3) Share through Nginx Proxy Manager (GUI)

This app stack is separate and joins Docker network: `nginx-proxy-manager-net`.

### Start Nginx Proxy Manager first

```bash
cd /home/vu/projects/nginx-proxy-manager
docker compose up -d
```

NPM GUI:

- `http://<YOUR_HOST_IP>:8181`

### Start practice-web stack (from its own folder)

```bash
cd /home/vu/projects/aws-saa-prac/practice-web
docker compose up -d --build
```

### Configure Proxy Host in NPM GUI

Create a new **Proxy Host**:

- `Domain Names`: your domain (example: `saa.home.local`)
- `Scheme`: `http`
- `Forward Hostname / IP`: `aws-saa-practice-web`
- `Forward Port`: `3000`
- Enable `Block Common Exploits`

Then add DNS/hosts mapping from client devices to your server IP for that domain.

## 4) Share on the same network (LAN)

The app listens on `0.0.0.0:3000`, so devices on your LAN can access it.

1. Get your host machine IP:

```bash
hostname -I | awk '{print $1}'
```

2. From another device on the same network, open:

- `http://<YOUR_HOST_IP>:3000`

Example: `http://192.168.1.25:3000`

If you use NPM proxy host, access by your configured domain instead of direct port.

## 5) Use custom local domain name

## 2) Use custom local domain name

Default domain is `saa-practice.local`. Add hosts mapping:

```bash
sudo sh -c 'echo "127.0.0.1 saa-practice.local" >> /etc/hosts'
```

Then open:

- `http://saa-practice.local:3000`

## 6) Change domain or port

```bash
APP_DOMAIN=my-aws-practice.local PORT=3000 npm start
```

If you change domain, add matching line in `/etc/hosts`.

For Docker Compose:

```bash
APP_DOMAIN=my-aws-practice.local docker compose up -d --build
```

For other LAN devices to use your custom domain, add the same hosts mapping on each device (or configure local DNS/router DNS).

## Project structure

- `server.js`: Express API + markdown/exam parser
- `public/`: frontend dashboard, doc viewer, exam UI, timer
