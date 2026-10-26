#!/usr/bin/env bash
# Rakit situs statis untuk Vercel: scan IDX, scan crypto, lalu rekam jejak
# hasil — ketiganya dalam SATU terbitan.
#
#   deploy/vercel/rakit.sh                                     # watchlist penuh
#   RAKIT_IDX="BBCA BSSR" RAKIT_CRYPTO="BTC-USD" deploy/vercel/rakit.sh   # uji cepat
#
# Hasilnya di situs/: berkas statis plus vercel.json. Di CI isinya dipush ke
# branch `site`, dan integrasi GitHub Vercel men-deploy branch itu.
#
# Kalau satu bagian tidak layak terbit — halaman tidak tertulis, terlalu banyak
# emiten gagal diambil, atau tanggal datanya mundur — skrip keluar non-nol dan
# situs/ lama tidak disentuh. Deploy Vercel yang sedang tayang tetap tayang;
# itu "snapshot terakhir yang sah".
#
# Ditulis untuk bash 3 (macOS) maupun Linux (GitHub Actions).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

# Batas emiten gagal untuk scan watchlist, persen. Sama dengan MAKS_GAGAL di
# src/hasil/nilai.ts: run di atas batas ini tidak dicatat, jadi juga tidak terbit.
MAKS_GAGAL_PERSEN="${MAKS_GAGAL_PERSEN:-5}"
KOMIT="$(git rev-parse --short HEAD)"
DITERBITKAN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAGE="$(mktemp -d)"
JEJAK="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$JEJAK"' EXIT

# jalankan NAMA BATAS_GAGAL PERINTAH...
# Menjalankan scan/hasil, memeriksa keluarannya, lalu menyalin halamannya ke
# $STAGE/NAMA. BATAS_GAGAL "ya" berarti rasio emiten gagal diperiksa.
jalankan() {
  local nama="$1" batas="$2"
  shift 2
  local log
  log="$(mktemp)"
  echo "== $(date -u '+%F %T') UTC $nama: $*" >&2
  # scan.ts dan hasil.ts keluar 1 kalau ada emiten gagal; yang diperiksa keluarannya.
  set +e
  "$@" 2>&1 | tee "$log" >&2
  set -e

  local html
  html="$(sed -n 's/^HTML : \([^ ]*\).*/\1/p' "$log" | tail -1)"
  if [[ -z "$html" || ! -f "$html" ]]; then
    echo "$nama: halaman tidak tertulis; tidak terbit." >&2
    return 1
  fi

  if [[ "$batas" == ya ]]; then
    local angka gagal total
    angka="$(sed -n 's/^\([0-9][0-9]*\) dari \([0-9][0-9]*\) emiten gagal diambil.*/\1 \2/p' "$log" | tail -1)"
    if [[ -n "$angka" ]]; then
      gagal="${angka% *}"
      total="${angka#* }"
      if (( gagal * 100 > total * MAKS_GAGAL_PERSEN )); then
        echo "$nama: $gagal dari $total emiten gagal (batas $MAKS_GAGAL_PERSEN%); tidak terbit." >&2
        return 1
      fi
    fi
  fi

  local sumber tanggal
  sumber="$(dirname "$html")"
  tanggal="$(basename "$sumber" | sed -n 's/.*\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)$/\1/p')"
  if [[ -z "$tanggal" ]]; then
    echo "$nama: tanggal data tidak terbaca dari $sumber; tidak terbit." >&2
    return 1
  fi

  # Tanggal data tidak boleh mundur dari terbitan sebelumnya — tanda Yahoo
  # mengirim data basi. Jejaknya disimpan di report/ (branch data di CI).
  local jejak="report/terbit-$nama.txt"
  if [[ -f "$jejak" ]]; then
    local lama
    lama="$(cat "$jejak")"
    if [[ "$tanggal" < "$lama" ]]; then
      echo "$nama: data $tanggal lebih tua dari terbitan $lama; tidak terbit." >&2
      return 1
    fi
  fi

  cp -R "$sumber" "$STAGE/$nama"
  printf '{"tanggal":"%s","diterbitkan":"%s","komit":"%s"}\n' "$tanggal" "$DITERBITKAN" "$KOMIT" \
    >"$STAGE/$nama/terbit.json"
  echo "$tanggal" >"$JEJAK/$nama"
  echo "$nama: data $tanggal siap terbit." >&2
}

# shellcheck disable=SC2086 # daftar kode sengaja dipecah per kata
jalankan idx ya bun run src/scan.ts --market idx --tanpa-idx ${RAKIT_IDX:-}
# shellcheck disable=SC2086
jalankan crypto ya bun run src/scan.ts --market crypto --tanpa-idx ${RAKIT_CRYPTO:-}
jalankan hasil tidak bun run src/hasil.ts

bun run src/beranda.ts "$STAGE/index.html" >&2
bun run src/jurnal.ts "$STAGE/jurnal/index.html" >&2

# Bundle verifikasi Google bersama fungsi, sehingga deploy Vercel tetap tanpa install.
mkdir -p "$STAGE/api"
bun build src/jurnal/api.ts --target=node --format=esm --outfile="$STAGE/api/jurnal.mjs"

# Tanpa build: Vercel menyajikan berkas apa adanya (api/ dijalankan sebagai
# fungsi, di sin1 supaya dekat dengan Redis-nya). no-cache karena nama berkas
# berulang tiap hari, kecuali api/: jurnal mengirim no-store sendiri supaya data
# pribadi tidak tersimpan di cache peramban. /idx tanpa garis miring dialihkan supaya fetch relatif
# `data/...` di halaman screener tidak patah.
cat >"$STAGE/vercel.json" <<'JSON'
{
  "framework": null,
  "buildCommand": "",
  "installCommand": "",
  "outputDirectory": ".",
  "regions": ["sin1"],
  "redirects": [{ "source": "/:bagian(idx|crypto|hasil|jurnal)", "destination": "/:bagian/", "permanent": true }],
  "headers": [
    {
      "source": "/((?!api/).*)",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
JSON

# Semua bagian lolos: baru sekarang jejak tanggal dan situs lama diganti.
for nama in idx crypto hasil; do cp "$JEJAK/$nama" "report/terbit-$nama.txt"; done
rm -rf situs
cp -R "$STAGE" situs
chmod 755 situs
echo "Situs terakit di situs/ (komit $KOMIT)." >&2
