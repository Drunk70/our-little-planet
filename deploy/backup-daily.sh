#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/our-little-planet
backup_dir=/var/backups/our-little-planet
test -d "$backup_dir"
backup_file="$backup_dir/planet-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
node scripts/backup.mjs create "$backup_file"
node scripts/backup.mjs verify "$backup_file"
# 仅在新备份完整性验证通过后，清理本目录 14 天前的日备份。
find "$backup_dir" -maxdepth 1 -type f -name 'planet-????????T??????Z.tar.gz' -mtime +14 -delete
