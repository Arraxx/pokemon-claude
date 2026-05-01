#!/usr/bin/env bash
# Downloads Pokémon Showdown's animated sprites (XY-style) into each gen1/{species} dir
# alongside the vscode-pokemon files, as `showdown_default.gif` and `showdown_shiny.gif`.
# Run `npm run vendor-sprites` first — this script reads the species list from gen1/.
# Network: fetches public assets from play.pokemonshowdown.com over HTTPS.
#
# By default, only 10 iconic gen1 species are fetched (lighter-weight try-out).
# Pass --all (or set POKEMON_CLAUDE_SHOWDOWN_ALL=1) to fetch the full gen1 set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN1_DIR="${ROOT}/assets/pokemon-media/gen1"
BASE_URL="${POKEMON_SHOWDOWN_BASE_URL:-https://play.pokemonshowdown.com/sprites}"

# Default sample. Change via --species "a,b,c" or fetch everything via --all.
DEFAULT_SPECIES=(pikachu charizard bulbasaur squirtle charmander mewtwo mew snorlax eevee gengar)

mode="default"
custom_species=""
for arg in "$@"; do
  case "$arg" in
    --all) mode="all" ;;
    --species=*) mode="custom"; custom_species="${arg#--species=}" ;;
    -h|--help)
      echo "Usage: $0 [--all] [--species=name1,name2,...]"
      echo "  Default: ${DEFAULT_SPECIES[*]}"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done
if [[ "${POKEMON_CLAUDE_SHOWDOWN_ALL:-0}" == "1" ]]; then mode="all"; fi

if [[ ! -d "${GEN1_DIR}" ]]; then
  echo "Error: ${GEN1_DIR} not found." >&2
  echo "Run \`npm run vendor-sprites\` first to populate the species list." >&2
  exit 1
fi

# Map vscode-pokemon dirname → Showdown sprite name. Identity for unlisted species.
showdown_name_for() {
  case "$1" in
    nidoran_female) echo "nidoranf" ;;
    nidoran_male)   echo "nidoranm" ;;
    pikachu_female) echo "pikachu-f" ;;
    venusaur_female) echo "venusaur" ;; # Showdown lacks a female variant; fall back to base form.
    *) echo "$1" ;;
  esac
}

fetch() {
  local url="$1" out="$2"
  # -f: fail on HTTP errors, -L: follow redirects, -s: silent, -S: still show errors, --max-time: cap.
  if curl -fLsS --max-time 30 -o "${out}.tmp" "$url"; then
    # Sanity check: must be a non-empty GIF.
    if [[ -s "${out}.tmp" ]] && head -c 4 "${out}.tmp" | grep -q "^GIF8"; then
      mv "${out}.tmp" "$out"
      return 0
    fi
  fi
  rm -f "${out}.tmp"
  return 1
}

# Build the list of species dirs to process.
species_list=()
case "$mode" in
  all)
    for d in "${GEN1_DIR}"/*/; do
      species_list+=("$(basename "$d")")
    done
    ;;
  custom)
    IFS=',' read -ra species_list <<< "$custom_species"
    ;;
  default)
    species_list=("${DEFAULT_SPECIES[@]}")
    ;;
esac

ok=0
fail=0
skipped=0

for species in "${species_list[@]}"; do
  dir="${GEN1_DIR}/${species}/"
  if [[ ! -d "$dir" ]]; then
    echo "  ! skipping ${species}: ${dir} does not exist (run npm run vendor-sprites first)" >&2
    fail=$((fail + 1))
    continue
  fi

  showdown="$(showdown_name_for "$species")"
  default_out="${dir}showdown_default.gif"
  shiny_out="${dir}showdown_shiny.gif"

  if [[ -s "$default_out" && -s "$shiny_out" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  if ! fetch "${BASE_URL}/ani/${showdown}.gif" "$default_out"; then
    echo "  ! default failed for ${species} (showdown name: ${showdown})" >&2
    fail=$((fail + 1))
    continue
  fi

  if ! fetch "${BASE_URL}/ani-shiny/${showdown}.gif" "$shiny_out"; then
    # Shiny missing — fall back to default so the renderer always has a file.
    cp "$default_out" "$shiny_out"
    echo "  ~ shiny missing for ${species}, using default" >&2
  fi

  ok=$((ok + 1))
  printf '.'
done
echo

echo "Showdown sprites (${mode}): ${ok} fetched, ${skipped} already present, ${fail} failed."
case "$mode" in
  default)
    echo "Tip: pass --all (or POKEMON_CLAUDE_SHOWDOWN_ALL=1) to fetch the full gen1 set."
    ;;
esac
echo "Set POKEMON_CLAUDE_SPRITE_STYLE=showdown to use them."
