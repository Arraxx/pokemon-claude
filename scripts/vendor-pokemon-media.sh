#!/usr/bin/env bash
# Copies vscode-pokemon media used by this app: gen1 sprites + root shared files (see upstream LICENSE and ATTRIBUTION.txt).
# Does not read your projects, Cursor data, or any personal files. Network is used only to git clone a public repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/assets/pokemon-media"
REPO_URL="${VSCODE_POKEMON_REPO_URL:-https://github.com/jakobhoeg/vscode-pokemon.git}"
REF="${VSCODE_POKEMON_REF:-main}"
TMP="${ROOT}/.cache/vscode-pokemon-src"

mkdir -p "${ROOT}/.cache"
rm -rf "${TMP}"
git clone --depth 1 --branch "${REF}" "${REPO_URL}" "${TMP}"

mkdir -p "${DEST}"
rsync -a --delete \
  --exclude 'gen2/' \
  --exclude 'gen3/' \
  --exclude 'gen4/' \
  --exclude 'icon/' \
  --exclude 'backgrounds/' \
  "${TMP}/media/" "${DEST}/"

rm -rf "${TMP}"
echo "Installed sprites to ${DEST} (gen1 + shared root assets; gen2–4, icon, backgrounds omitted)."
