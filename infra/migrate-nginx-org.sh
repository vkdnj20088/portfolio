#!/usr/bin/env bash
#
# nginx 를 우분투 패키지에서 nginx.org 공식 안정판으로 바꾼다. 설정 트리(/etc/nginx)는 그대로 살린다.
#
#   sudo bash infra/migrate-nginx-org.sh
#
# 왜: 2026-11-18 nginx 보안 공지(HTTP/2 흐름 제어 원격 코드 실행 CVE-2026-123007, HTTP/2 해제 후 사용
# CVE-2026-123633, TLS 1.3 요청 본문 무한 루프 CVE-2026-118899 등 10건). nginx.org 는 같은 날 1.30.7 을
# 냈지만 우분투 패키지는 미수정이었다. 이 서버는 8개 포트 전부 HTTP/2 를 켜고 있어 영향권이다.
#
# 여러 번 돌려도 된다. 이미 nginx.org 판이면 최신 안정판으로 올리고 다시 띄우기만 한다.
# 실패하면(새 판에서 설정 검사가 안 통과하면) 우분투 판과 원래 설정으로 되돌린다.
set -euo pipefail

NGINX_MIN=1.30.7
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/nginx-backup/${STAMP}"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[실패] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요(sudo)."
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

old_ver="$(dpkg-query -W -f='${Version}' nginx 2>/dev/null || true)"
[[ -n "$old_ver" ]] || die "nginx 가 깔려 있지 않습니다. provision.sh 를 먼저 실행하세요."

log "1) nginx.org 저장소(서명 키 지문 확인)"
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor --yes -o /usr/share/keyrings/nginx-archive-keyring.gpg
fprs="$(gpg --dry-run --quiet --no-keyring --import --import-options import-show --with-colons \
  /usr/share/keyrings/nginx-archive-keyring.gpg | awk -F: '$1=="fpr"{print $10}')"
[[ -n "$GNUPGHOME" && -d "$GNUPGHOME" ]] && rm -rf -- "$GNUPGHOME"
unset GNUPGHOME
grep -qx 573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62 <<<"$fprs" \
  || die "nginx.org 서명 키에 공식 문서의 지문이 없습니다. 받은 지문: $(echo $fprs)"
codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu ${codename} nginx" \
  > /etc/apt/sources.list.d/nginx.list
printf 'Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n' > /etc/apt/preferences.d/99nginx
# 자동 보안 업데이트는 기본으로 우분투 저장소만 본다. nginx.org 판도 저절로 올라가게 넣는다.
printf 'Unattended-Upgrade::Origins-Pattern { "origin=nginx,codename=%s"; };\n' "$codename" \
  > /etc/apt/apt.conf.d/52unattended-nginx-org
apt-get update -y

if [[ "$old_ver" != *ubuntu* ]]; then
  log "이미 nginx.org 판(${old_ver}) - 최신 안정판으로 올린다"
  apt-get install -y --only-upgrade nginx
  nginx -t
  systemctl restart nginx   # reload 는 실행 중인 바이너리를 새 판으로 바꾸지 않는다
else
  log "2) 백업: ${BACKUP}"
  install -d -m 700 /root/nginx-backup "$BACKUP"
  cp -a /etc/nginx "$BACKUP/etc-nginx"
  # 우분투 nginx-common 을 purge 하면 로그 폴더도 지운다. 지난 접속 기록은 남겨 둔다.
  cp -a /var/log/nginx "$BACKUP/log-nginx" 2>/dev/null || true

  rollback() {
    warn "새 판으로 띄우지 못했다 - 우분투 판(${old_ver})과 원래 설정으로 되돌린다"
    rm -f /etc/apt/sources.list.d/nginx.list /etc/apt/preferences.d/99nginx /etc/apt/apt.conf.d/52unattended-nginx-org
    apt-get update -y
    # 되돌리는 설치도 기본 설정으로 먼저 뜨려다 실패하지 않게 자동 기동을 막아 둔다.
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
    chmod 755 /usr/sbin/policy-rc.d
    apt-get purge -y nginx || true
    apt-get install -y --allow-downgrades "nginx=${old_ver}" "nginx-common=${old_ver}"
    rm -f /usr/sbin/policy-rc.d
    rsync -a --delete "$BACKUP/etc-nginx/" /etc/nginx/
    nginx -t && systemctl restart nginx
    die "되돌렸다(우분투 ${old_ver}). 원인은 위의 nginx -t 출력을 보세요. 백업: ${BACKUP}"
  }

  log "3) 패키지 교체 (${old_ver} -> nginx.org)"
  mapfile -t old_pkgs < <(dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' 'nginx*' 'libnginx-mod-*' 2>/dev/null \
    | awk '$2=="installed"{print $1}')
  # 새 패키지가 설치 직후 자기 기본 설정으로 뜨려다 실패하면 설치 명령 자체가 실패로 끝난다.
  # 설정을 되살린 뒤 직접 띄우도록 설치 중 자동 기동을 막는다.
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  apt-get purge -y "${old_pkgs[@]}"
  apt-get install -y nginx || rollback
  rm -f /usr/sbin/policy-rc.d

  log "4) 설정 트리 되살리기"
  rsync -a --delete "$BACKUP/etc-nginx/" /etc/nginx/
  # 작업 프로세스 사용자. nginx.org 판의 임시 폴더(/var/cache/nginx/*_temp - 큰 요청 본문, 프록시 버퍼)는
  # nginx 사용자 것이라 www-data 로 두면 큰 업로드/응답에서 권한 오류가 난다. 웹루트는 전부 누구나 읽기 가능(755).
  sed -i -E 's/^user[[:space:]]+www-data;/user nginx;/' /etc/nginx/nginx.conf
  # 우분투 판의 동적 모듈 목록. 이 서버는 쓰는 모듈이 없고(비어 있음), nginx.org 판에는 그 모듈 파일이 없다.
  sed -i -E '\|^include /etc/nginx/modules-enabled/\*\.conf;|d' /etc/nginx/nginx.conf
  install -d -o nginx -m 755 /var/log/nginx
  nginx -t || rollback
  systemctl enable nginx >/dev/null
  systemctl restart nginx || rollback
fi

new_ver="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
dpkg --compare-versions "$new_ver" ge "$NGINX_MIN" || die "nginx ${new_ver} - ${NGINX_MIN} 이상이 필요합니다."

log "5) 쓰지 않는 커널 기능(SCTP) 끄기"
# 같은 공지의 연구진은 nginx 워커 권한 코드 실행을 커널 SCTP 결함과 엮어 root 까지 올렸다. 이 서버는 SCTP 를 안 쓴다.
printf 'install sctp /bin/false\nblacklist sctp\n' > /etc/modprobe.d/disable-sctp.conf
modprobe -r sctp 2>/dev/null || true

log "6) 확인"
echo "nginx ${new_ver} ($(dpkg-query -W -f='${Version}' nginx)), $(systemctl is-active nginx)"
ps -o user= -C nginx | sort | uniq -c | sed 's/^/  프로세스 사용자: /'
certbot renew --dry-run >/dev/null 2>&1 && echo "인증서 갱신 리허설 통과(갱신 훅이 새 nginx 를 다시 읽는다)" \
  || warn "인증서 갱신 리허설 실패 - certbot renew --dry-run 으로 원인을 확인하세요."
[[ -f /var/run/reboot-required ]] && warn "커널 갱신 재부팅이 대기 중입니다(sudo reboot). 서비스는 모두 부팅 때 다시 뜹니다."
echo "백업: ${BACKUP}"
