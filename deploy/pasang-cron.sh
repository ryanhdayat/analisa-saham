#!/usr/bin/env bash
# Pasang atau perbarui jadwal dari deploy/jadwal.conf ke crontab pengguna ini.
#
# Hanya blok di antara dua penanda di bawah yang ditulis ulang; baris crontab
# lain dibiarkan. Aman dijalankan berulang kali.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=jadwal.conf
source "$REPO/deploy/jadwal.conf"
mkdir -p "$REPO/logs"

MULAI="# >>> analisa-saham (dikelola deploy/pasang-cron.sh) >>>"
SELESAI="# <<< analisa-saham <<<"

blok="$MULAI
$IDX_JADWAL $REPO/deploy/terbit.sh idx >> $REPO/logs/terbit-idx.log 2>&1
$CRYPTO_JADWAL $REPO/deploy/terbit.sh crypto >> $REPO/logs/terbit-crypto.log 2>&1
$HASIL_JADWAL $REPO/deploy/terbit.sh hasil >> $REPO/logs/terbit-hasil.log 2>&1
$SELESAI"

{
  { crontab -l 2>/dev/null || true; } |
    awk -v a="$MULAI" -v b="$SELESAI" '$0 == a { skip = 1 } !skip { print } $0 == b { skip = 0 }'
  echo "$blok"
} | crontab -

echo "Crontab terpasang:"
crontab -l | awk -v a="$MULAI" -v b="$SELESAI" '$0 == a { on = 1 } on { print } $0 == b { on = 0 }'
