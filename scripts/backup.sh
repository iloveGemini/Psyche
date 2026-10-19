#!/bin/zsh
# 屋子的备份（10-19 Joy 定：放 iCloud、加密、留 14 份）
#
#   backup.sh            打一包：每个住户的 psyche.db（sqlite .backup，开着 WAL 也一致）+ data 下的配置
#                        + ~/.soma（群、住户的家和配置、commons；缓存类不要）→ tar | zstd | openssl → iCloud
#   backup.sh restore <包> <目录>   解到 <目录>（不碰正在用的数据；要还原自己挑着拷回去）
#   backup.sh check      解最新一包到临时目录，每个库跑 integrity_check
#
# 钥匙 ~/.psyche/backup.key：不进任何备份包，丢了包就打不开——Joy 另存了一份在 Mac 以外。
# 包在 iCloud 里：有人删了文件夹，iCloud.com 的「最近删除」还能找回 30 天。
set -euo pipefail
setopt null_glob

DATA=${PSYCHE_DATA_DIR:-$HOME/.psyche/data}
SOMA=${SOMA_DIR:-$HOME/.soma}
DEST=${BACKUP_DEST:-"$HOME/Library/Mobile Documents/com~apple~CloudDocs/Psyche备份"}
KEY=${BACKUP_KEY:-$HOME/.psyche/backup.key}
KEEP=${KEEP:-14}
ITER=200000

enc() { ( umask 077; openssl enc -aes-256-cbc -salt -pbkdf2 -iter $ITER -pass "file:$KEY" -out "$1" ) }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter $ITER -pass "file:$KEY" -in "$1" | zstd -dq | tar -C "$2" -xf - }

backup() {
  [[ -f $KEY ]] || { ( umask 077; openssl rand -base64 48 > "$KEY" ); echo "新钥匙：$KEY（另存一份到 Mac 以外）"; }
  mkdir -p "$DEST"
  local tmp=$(mktemp -d) stamp=$(date +%Y%m%d-%H%M%S)
  trap "rm -rf '$tmp'" EXIT
  mkdir -p "$tmp/psyche"
  for db in "$DATA"/*/psyche.db; do
    local id=${db:h:t}
    mkdir -p "$tmp/psyche/$id"
    sqlite3 "$db" ".backup '$tmp/psyche/$id/psyche.db'"
    # 向量是派生缓存（archive/vectors.ts），还原后后台会补；一条 16KB 压不动，占了包的大半
    sqlite3 "$tmp/psyche/$id/psyche.db" "DROP TABLE IF EXISTS p_vec; VACUUM;"
  done
  for f in "$DATA"/*(.); do cp "$f" "$tmp/psyche/"; done
  tar -C "$SOMA/.." -cf "$tmp/soma.tar" \
    --exclude '.soma/claude/cache' --exclude '.soma/claude/chrome' --exclude '.soma/claude/shell-snapshots' \
    --exclude '.soma/claude/plugins' --exclude '.soma/logs' --exclude '.DS_Store' "${SOMA:t}"
  local out="$DEST/psyche-$stamp.tar.zst.enc"
  # 先在本地加密好再拷进去：launchd 里在 iCloud 文件夹里改名会被拦（Operation not permitted），新建可以
  tar -C "$tmp" -cf - psyche soma.tar | zstd -q -10 -T0 | enc "$tmp/out.enc"
  cp "$tmp/out.enc" "$out"
  local old=( "$DEST"/psyche-*.tar.zst.enc(Om) )
  # 删旧包也走 bun：launchd 里 /bin/rm 删 iCloud 里的文件同样被拦，bun 有授权
  (( ${#old} > KEEP )) && bun -e 'for (const f of process.argv.slice(1)) require("fs").unlinkSync(f)' "${old[@]:0:$(( ${#old} - KEEP ))}"
  echo "$(date '+%F %T') → $out ($(du -h "$out" | cut -f1))"
}

check() {
  local last=( "$DEST"/psyche-*.tar.zst.enc(om[1]) )
  [[ -n ${last:-} ]] || { echo "没有包"; exit 1; }
  local tmp=$(mktemp -d); trap "rm -rf '$tmp'" EXIT
  dec "$last[1]" "$tmp"
  for db in "$tmp"/psyche/*/psyche.db; do
    echo "${db:h:t}: $(sqlite3 "$db" 'PRAGMA integrity_check') · $(sqlite3 "$db" 'SELECT COUNT(*) FROM events') 条"
  done
  tar -tf "$tmp/soma.tar" | wc -l | xargs echo "soma: 文件"
}

case ${1:-backup} in
  backup) backup ;;
  check) check ;;
  restore) [[ $# -eq 3 ]] || { echo "用法：backup.sh restore <包> <目录>"; exit 2; }; mkdir -p "$3"; dec "$2" "$3"; echo "解到 $3（soma.tar 再 tar -xf 一次）" ;;
  *) echo "用法：backup.sh [backup|check|restore <包> <目录>]"; exit 2 ;;
esac
