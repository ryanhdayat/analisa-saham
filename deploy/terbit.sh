#!/usr/bin/env bash
# Jalankan scan satu pasar (atau penilaian hasil) lalu terbitkan halamannya ke WEB_ROOT.
#
#   deploy/terbit.sh idx
#   deploy/terbit.sh crypto
#   deploy/terbit.sh crypto BTC ETH   # argumen sisanya diteruskan ke scan.ts
#   deploy/terbit.sh hasil            # rekam jejak pilihan kedua pasar (src/hasil.ts)
#
# Terbitan diganti secara atomik: <WEB_ROOT>/<nama> adalah symlink ke folder
# rilis, dan baru dipindah setelah rilis baru tersalin utuh. Kalau scan gagal
# menulis halaman, terbitan lama tetap tayang.
set -euo pipefail

PASAR="${1:-}"
case "$PASAR" in
  idx | crypto | hasil) ;;
  *) echo "Pakai: $0 idx|crypto|hasil" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=jadwal.conf
source "$REPO/deploy/jadwal.conf"
# cron membawa PATH minimal; bun dipasang per pengguna.
export PATH="$HOME/.bun/bin:$PATH"
cd "$REPO"

# Satu scan per pasar pada satu waktu: run yang molor tidak boleh ditumpuk run berikutnya.
exec 9>"/tmp/analisa-saham-$PASAR.lock"
flock -n 9 || { echo "Scan $PASAR masih berjalan; dilewati."; exit 0; }

echo "== $(date '+%F %T') scan $PASAR"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

opsi_var="${PASAR^^}_OPSI"
if [[ "$PASAR" == hasil ]]; then
  perintah=(bun run src/hasil.ts)
else
  perintah=(bun run src/scan.ts --market "$PASAR")
fi
# scan.ts dan hasil.ts keluar 1 kalau ada emiten yang gagal diambil. Itu biasa —
# halamannya tetap ditulis — jadi yang diperiksa adalah keluarannya, bukan exit code-nya.
set +e
# shellcheck disable=SC2086 # opsi sengaja dipecah per kata
"${perintah[@]}" ${!opsi_var:-} "${@:2}" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e
echo "scan selesai, exit $status"

html="$(sed -n 's/^HTML : \([^ ]*\).*/\1/p' "$log")"
if [[ -z "$html" || ! -f "$html" ]]; then
  echo "Halaman screener tidak tertulis; terbitan lama dipertahankan." >&2
  exit 1
fi
if grep -qE '^([0-9]+) dari \1 emiten gagal' "$log"; then
  echo "Semua emiten gagal diambil; terbitan lama dipertahankan." >&2
  exit 1
fi

sumber="$(dirname "$html")"
tanggal="?"
[[ "$sumber" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2})$ ]] && tanggal="${BASH_REMATCH[1]}"
nama="$PASAR-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WEB_ROOT/rilis"
cp -r "$sumber" "$WEB_ROOT/rilis/$nama.tmp"
printf '{"tanggal":"%s","diterbitkan":"%s"}\n' "$tanggal" "$(date -Iseconds)" >"$WEB_ROOT/rilis/$nama.tmp/terbit.json"
mv "$WEB_ROOT/rilis/$nama.tmp" "$WEB_ROOT/rilis/$nama"

ln -sfn "rilis/$nama" "$WEB_ROOT/$PASAR.baru"
mv -Tf "$WEB_ROOT/$PASAR.baru" "$WEB_ROOT/$PASAR"
cp "$REPO/deploy/web/index.html" "$WEB_ROOT/index.html"

# Simpan dua rilis terakhir per pasar; yang lebih lama tidak lagi ditunjuk siapa pun.
find "$WEB_ROOT/rilis" -mindepth 1 -maxdepth 1 -name "$PASAR-*" | sort -r | tail -n +3 | xargs -r rm -rf

echo "Terbit: $PASAR data $tanggal → $WEB_ROOT/$PASAR"
