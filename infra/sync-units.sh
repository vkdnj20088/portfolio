#!/usr/bin/env bash
#
# /usr/local/sbin/portfolio-sync-units (root 소유 0755). 배포가 올려 둔 systemd 유닛을
# /etc/systemd/system 으로 반영하고 daemon-reload 한다. 배포 계정이 sudo 로 부른다.
#
# 인자를 받지 않는다. 경로를 인자로 받으면 "아무 파일이나 root 권한으로 덮어쓰는 통로"가
# 되기 때문이다. 원본 경로와 파일명 패턴을 코드에 고정한다.
#
# 보안 트레이드오프: 배포 계정이 /opt/portfolio/units 에 쓸 수 있으므로, 이 스크립트는
# 사실상 "배포 계정이 유닛 내용을 정한다"는 뜻이다. 그래서 최소 방어로 User=deploy 가
# 없는 유닛은 거부한다 - root 로 도는 서비스를 심어 권한을 올리는 가장 뻔한 경로를 막는다.
set -euo pipefail

SRC=/opt/portfolio/units
DEST=/etc/systemd/system

shopt -s nullglob
files=("$SRC"/portfolio-*.service)
if [ ${#files[@]} -eq 0 ]; then
  echo "동기화할 유닛이 없습니다: $SRC"
  exit 0
fi

for f in "${files[@]}"; do
  grep -qE '^User=deploy$' "$f" || {
    echo "거부: $(basename "$f") 에 User=deploy 가 없습니다(권한 상승 방지)" >&2
    exit 1
  }
done

install -m 0644 -o root -g root "${files[@]}" "$DEST/"
systemctl daemon-reload
echo "유닛 ${#files[@]}개 반영 + daemon-reload 완료"
