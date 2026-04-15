# Setup Docker

Instructions to run maclaw in Docker on a remote EC2 host without needing Docker
locally.

- Verify the remote host already has a working maclaw checkout.
- Install Docker on the remote host and enable the daemon.
- Build the maclaw image on the remote host from the checked-out repo.
- Create host-backed directories for `MACLAW_HOME` and project data.
- Write a simple `server.json` and project `.maclaw/maclaw.json` on the host.
- Run the container with host networking so maclaw can keep binding
  `127.0.0.1:4000`.
- Run the container with host PID mode so project lock files record real host
  PIDs.
- Keep using Session Manager or SSH port forwarding exactly as before.
- Teleport into the remote and verify `/tools` and `/config show`.

## Key Findings

- Plain port publishing with `-p 127.0.0.1:4000:4000` was not enough because
  maclaw currently binds `127.0.0.1` inside the container.
- Host networking fixed the HTTP reachability problem.
- Host PID mode fixed project lock conflicts caused by the container recording
  PID `1` in the lock file.
- Mounted JSON config files must be written as valid JSON, not escaped strings.

## Command Reference

Main remote Docker setup commands:

```shell
sudo dnf install -y docker
sudo systemctl enable --now docker

cd ~/maclaw
docker build -t maclaw:dev .
```

Main host-backed config layout:

```shell
mkdir -p ~/maclaw-data/home
mkdir -p ~/maclaw-data/projects/remote/.maclaw

cat > ~/maclaw-data/projects/remote/.maclaw/maclaw.json <<'EOF'
{
  "name": "remote",
  "model": "openai/gpt-4.1-mini",
  "storage": "json",
  "tools": ["read", "dangerous"]
}
EOF

cat > ~/maclaw-data/home/server.json <<'EOF'
{
  "defaultProject": "remote",
  "projects": [
    {
      "name": "remote",
      "folder": "/data/projects/remote"
    }
  ]
}
EOF
```

Main container start command:

```shell
docker rm -f maclaw-server || true
rm -f ~/maclaw-data/projects/remote/.maclaw/lock.json

docker run -d \
  --name maclaw-server \
  --restart unless-stopped \
  --network host \
  --pid host \
  -e MACLAW_HOME=/data/home \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -v ~/maclaw-data/home:/data/home \
  -v ~/maclaw-data/projects:/data/projects \
  maclaw:dev
```

Main verification commands on the remote host:

```shell
docker ps --filter name=maclaw-server
docker logs --tail 80 maclaw-server

python3 - <<'PY'
import json, urllib.request
body = json.dumps({
  "project": "remote",
  "chatId": "default",
  "text": "/tools",
}).encode()
req = urllib.request.Request(
  "http://127.0.0.1:4000/api/command",
  data=body,
  headers={"content-type": "application/json; charset=utf-8"},
)
with urllib.request.urlopen(req, timeout=10) as response:
  print(response.status)
  print(response.read().decode())
PY
```

Main local teleport verification:

```shell
maclaw teleport aws-dev --project remote "/tools"
maclaw teleport aws-dev --project remote "/config show"
```
