#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C LD_BIND_NOW=1

work="$PWD/build/cibench"
artifacts="$work/artifacts"
inputs="$work/inputs"
mkdir -p "$artifacts" "$inputs"

# Pin input bytes independently of the three parser revisions.
input_commit=12956e2662ec632efa7e23fe2a4db1c52f3d7a6a
baseline_commit=d6501de34e9aabad1f49b860fcfcc23066766223
if [[ "$BENCH_REFS" == default ]]; then
  BENCH_REFS="v1.0.0 v3.1.0 HEAD"
fi
if [[ ! "$BENCH_REFS" =~ ^[a-zA-Z0-9_./\ -]+$ ]]; then
  echo 'bench_refs must be space-separated Git refs or commit hashes' >&2
  exit 2
fi
read -r -a refs <<< "$BENCH_REFS"
if (( ${#refs[@]} < 2 )) || [[ "${refs[0]}" != v1.0.0 ]]; then
  echo 'bench_refs must start with v1.0.0 and include a comparison ref' >&2
  exit 2
fi
if [[ -n "$BENCH_MAX_INCREASE_PCT" && ! "$BENCH_MAX_INCREASE_PCT" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo 'bench_max_increase_pct must be a nonnegative percentage' >&2
  exit 2
fi

flags=(-std=c11 -O2 -g -DNDEBUG -D_POSIX_C_SOURCE=200112L -D_DEFAULT_SOURCE)
go mod download -json github.com/tree-sitter/go-tree-sitter@v0.25.0 > "$artifacts/runtime.json"
runtime=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).Dir' "$artifacts/runtime.json")
{
  echo "Inputs: $input_commit"
  echo "CFLAGS: ${flags[*]}"
  echo "Runner image: ${ImageOS:-unknown} ${ImageVersion:-unknown}"
  gcc --version
  ldd --version
  valgrind --version
  go version
  node --version
} > "$artifacts/tools.txt"
gcc "${flags[@]}" -I"$runtime/include" -I"$runtime/src" -c "$runtime/src/lib.c" -o "$work/runtime.o"
gcc "${flags[@]}" -DPARSE_BENCH_CALLGRIND -I"$runtime/include" -c scripts/parse-bench.c -o "$work/harness.o"

for i in "${!refs[@]}"; do
  ref="${refs[$i]}"
  commit=$(git rev-parse --quiet --verify --end-of-options "$ref^{commit}" ||
    git rev-parse --verify --end-of-options "refs/remotes/origin/$ref^{commit}")
  if [[ $i == 0 && "$commit" != "$baseline_commit" ]]; then
    echo 'v1.0.0 no longer resolves to the baseline commit' >&2
    exit 2
  fi
  grammar="$work/grammar-$i"
  mkdir -p "$grammar"
  git archive "$commit" src/parser.c src/scanner.c src/tree_sitter | tar -x -C "$grammar"
  (cd "$grammar" && sha256sum src/parser.c src/scanner.c src/tree_sitter/*.h) > "$artifacts/$i-sources.sha256"
  gcc "${flags[@]}" -I"$grammar/src" "$grammar/src/parser.c" "$grammar/src/scanner.c" \
    "$work/runtime.o" "$work/harness.o" -o "$work/parse-$i"
  printf '%s\t%s\n' "$ref" "$commit"
done > "$artifacts/refs.tsv"

git archive "$input_commit" test/corpus examples test/highlight test/tags oracle/cases.jsonl \
  oracle/n-of-m/inputs.jsonl oracle/discover/manifest.json | tar -x -C "$inputs"
manifest="$inputs/oracle/discover/manifest.json"
cp "$manifest" "$artifacts/discovery-manifest.json"
node oracle/discover/fetch.mjs --npm-only --manifest "$manifest" --data "$work/data"
node scripts/parse-bench-inputs.mjs "$work/data" "$manifest" "$work/npm.jsonl" > "$artifacts/npm-selection.txt"
(cd oracle/replay && go build -p 2 -o "$work/replay" .)
"$work/replay" -root "$inputs" -pack-inputs "$work/default.bin"
"$work/replay" -root "$inputs" -pack-inputs "$work/n-of-m.bin" "$inputs/oracle/n-of-m/inputs.jsonl"
"$work/replay" -root "$inputs" -pack-inputs "$work/npm.bin" "$work/npm.jsonl"
(cd "$work" && sha256sum default.bin n-of-m.bin npm.bin) > "$artifacts/input-packs.sha256"
cp "$work/"*.bin.jsonl "$artifacts/"

# Interleave refs for each workload. The native run records process peak RSS in KiB.
for set in default n-of-m npm; do
  for mode in fresh incremental; do
    for i in "${!refs[@]}"; do
      out="$artifacts/$i-$set-$mode"
      echo "Measuring ${refs[$i]} $set $mode"
      /usr/bin/time -f '%M %e' -o "$out.time" \
        "$work/parse-$i" "$work/$set.bin" "$mode" > "$out.native-tally"
      valgrind --tool=callgrind --collect-atstart=no --dump-line=no --callgrind-out-file="$out.callgrind" \
        "$work/parse-$i" "$work/$set.bin" "$mode" > "$out.tally"
    done
  done
done
node scripts/parse-bench-summary.mjs "$artifacts" "$BENCH_MAX_INCREASE_PCT"
