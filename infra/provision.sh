#!/usr/bin/env bash
# 새 EC2(Ubuntu 24.04, arm64/t4g 권장) 최초 1회 프로비저닝. root 또는 sudo 로 실행한다.
#   sudo bash infra/provision.sh
# 설치: nginx, JDK 21, Node 22, Docker(+MySQL 8 컨테이너), 스왑, 배포 사용자/디렉터리,
#       systemd 유닛 4개, nginx 설정(포트 분리), 인트로 웹루트.
# 시크릿(DB 비번 등)은 여기서 넣지 않는다 - /etc/portfolio/*.env 를 이후에 채운다.
#
# 목표 스펙: t4g.small(2 vCPU / 2GB / arm64). 다섯 데모가 한 대에 사는 구성이라 메모리가
# 가장 빡빡한 자원이다. 그래서 이 스크립트는 (1) 스왑 2GB, (2) MySQL 메모리 축소 옵션,
# (3) systemd 유닛의 힙 상한을 함께 깐다. 이 셋이 없으면 2GB 에서는 OOM 이 난다.
set -euo pipefail

DEPLOY_USER=deploy
APP_ROOT=/opt/portfolio
APPS=(chat docqa exchange backend loandoc)
ACME_WEBROOT=/var/www/acme
INTRO_WEBROOT=/var/www/intro
INFRA="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

log "패키지(nginx / JDK 21 / 도구)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
# python3-venv: loandoc(FastAPI) 릴리스 venv 용. fonts-nanum: loandoc 시각화의 한글 라벨용.
apt-get install -y nginx openjdk-21-jre-headless curl ca-certificates gnupg rsync \
  python3-venv fonts-nanum

log "Node 22 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io
fi

log "스왑 2GB (2GB 인스턴스의 안전장치)"
# 상시 스왑을 쓰겠다는 뜻이 아니다. 재배포처럼 순간적으로 메모리가 겹치는 구간에서 OOM 킬러가
# 아무 프로세스나 죽이는 대신 잠깐 느려지고 넘어가게 하는 보험이다(비용 0).
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# 스왑은 최후 수단으로만 쓰이게 한다(기본 60 이면 여유가 있어도 디스크로 밀어내 느려진다).
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-portfolio.conf
sysctl --quiet -p /etc/sysctl.d/99-portfolio.conf || true

log "배포 사용자 / 디렉터리"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
# 배포 실패 시 러너가 원인 로그를 그대로 끌어올 수 있게(sudo 없이 journalctl 읽기).
usermod -aG systemd-journal "$DEPLOY_USER"
for app in "${APPS[@]}"; do mkdir -p "$APP_ROOT/$app/releases"; done
# 배포가 유닛 파일을 올려 두는 자리(루트 헬퍼가 여기서만 읽어 /etc 로 반영한다).
mkdir -p "$APP_ROOT/units"
mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge" "$INTRO_WEBROOT" /etc/portfolio
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_ROOT" "$INTRO_WEBROOT"
chmod 750 /etc/portfolio

log "MySQL 8 컨테이너(127.0.0.1:3306 루프백 바인딩)"
# 아래 두 __...__ 플레이스홀더는 실행 전에 실제 값으로 치환한다. MYSQL_USER/PASSWORD 는
# 앱 접속용 non-root 유저(extuser)를 extdb 에 대한 권한과 함께 생성한다 - backend.env 의
# DB_USER=extuser / DB_PASSWORD 와 일치해야 백엔드가 접속된다. 이 세 MYSQL_* 값은 빈 볼륨
# 최초 기동 시에만 반영된다(이미 extdb-data 볼륨이 있으면 docker rm + docker volume rm 후 재기동).
#
# 메모리 옵션: 기본값(buffer pool 128MB + performance_schema)은 2GB 서버에서 400~500MB 를 쓴다.
# 이 데모의 데이터는 수십 MB 규모라 버퍼 풀을 96MB 로 줄이고 계측 스키마를 끄면 250~300MB 로 내려온다.
if ! docker inspect extdb-mysql >/dev/null 2>&1; then
  docker run -d --name extdb-mysql --restart unless-stopped \
    -p 127.0.0.1:3306:3306 \
    -e MYSQL_DATABASE=extdb \
    -e MYSQL_USER=extuser -e MYSQL_PASSWORD="__SYNC_WITH_backend.env_DB_PASSWORD__" \
    -e MYSQL_ROOT_PASSWORD="__SET_STRONG_ROOT_PW__" \
    -v extdb-data:/var/lib/mysql \
    --memory=640m --memory-swap=1g \
    mysql:8.0 \
    --innodb-buffer-pool-size=96M \
    --performance-schema=OFF \
    --innodb-log-buffer-size=8M \
    --max-connections=30 \
    --table-open-cache=256
fi

log "systemd 유닛 + nginx 설정 배치"
cp "$INFRA"/systemd/portfolio-*.service /etc/systemd/system/
# 배포가 유닛을 스스로 반영할 수 있게 하는 루트 헬퍼(인자 없음 - 경로/패턴 고정).
install -m 0755 -o root -g root "$INFRA/sync-units.sh" /usr/local/sbin/portfolio-sync-units
install -d /etc/nginx/snippets
cp "$INFRA/nginx/snippets/tls-ip.conf"    /etc/nginx/snippets/portfolio-tls-ip.conf
cp "$INFRA/nginx/snippets/proxy-app.conf" /etc/nginx/snippets/portfolio-proxy-app.conf
cp "$INFRA/nginx/portfolio.conf"           /etc/nginx/sites-available/portfolio
cp "$INFRA/nginx/portfolio-bootstrap.conf" /etc/nginx/sites-available/portfolio-bootstrap
# 인증서가 아직 없으므로 본 설정(TLS 블록)을 켜면 nginx -t 가 실패하고, 그러면 80 포트의 ACME
# 경로도 못 떠서 발급 자체가 막힌다(닭과 달걀). 발급 전에는 80 전용 부트스트랩만 켠다 -
# issue-cert-ip.sh 가 발급 후 본 설정으로 교체한다.
ln -sfn /etc/nginx/sites-available/portfolio-bootstrap /etc/nginx/sites-enabled/portfolio-bootstrap
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/portfolio
[ -f /etc/portfolio/backend.env ]  || cp "$INFRA/env/backend.env.example"  /etc/portfolio/backend.env
[ -f /etc/portfolio/frontend.env ] || cp "$INFRA/env/frontend.env.example" /etc/portfolio/frontend.env
chmod 600 /etc/portfolio/*.env
systemctl daemon-reload

log "완료 - 남은 수동 단계"
cat <<'NEXT'
  1) 보안그룹 인바운드 개방: 80, 443, 8443, 9443, 9444, 9445, 9446 (TCP)
     - 80 은 인증서 갱신(ACME) 때문에 반드시 필요하다.
  2) /etc/portfolio/backend.env 의 DB_PASSWORD 를 위 컨테이너 MYSQL_PASSWORD(extuser 용)와
     동일하게 채우기. DB_USER 는 extuser 그대로. (컨테이너 MYSQL_* 플레이스홀더도 실행 전 치환.)
  3) IP 인증서 발급 + 통합 설정 활성화(한 방에):
        sudo -E LE_EMAIL=you@example.com bash infra/issue-cert-ip.sh
     발급(단수명 6일) -> 스니펫에 인증서 경로 심기 -> 부트스트랩에서 본 설정으로 교체 ->
     갱신 타이머(6시간)까지 구성한다. 실패하면 80 전용으로 자동 롤백해 갱신 경로는 살아 있다.
     (80 포트의 /.well-known/acme-challenge/ 블록은 절대 덮지 말 것 - 6일 갱신 생명선.)
  4) 첫 배포: GitHub Actions 의 deploy 워크플로(workflow_dispatch, target=all) 실행.
     인트로(정적)까지 함께 올라간다.
  5) 배포 계정 sudoers(무암호) - 유닛 자동 반영까지 포함:
     /etc/sudoers.d/portfolio 에 restart/reset-failed **앱 수만큼** + /usr/local/sbin/portfolio-sync-units
     (앱을 늘리면 이 목록도 늘린다 - 빠뜨린 앱만 재기동에서 비밀번호를 물어 실패한다.)
     (infra/README.md 의 "배포 (GitHub Actions)" 절에 전체 한 줄이 있다.)
  6) 기동 확인:
     systemctl enable --now portfolio-chat portfolio-docqa portfolio-exchange portfolio-backend portfolio-loandoc
     free -m   # 유휴 기준 사용량 1.0~1.3GB 면 정상(2GB 인스턴스)
NEXT
