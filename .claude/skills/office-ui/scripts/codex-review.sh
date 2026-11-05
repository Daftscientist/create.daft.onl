#!/usr/bin/env bash
# Adversarial UI review by Codex (GPT 6.1 Sol), read-only.
#
# usage: codex-review.sh <effort> <brief.md> <out.md> [image ...]
#   effort: high | xhigh | max   (ultra only when the user asks)
#   brief:  full self-contained prompt; Codex sees nothing of the conversation
#   images: screenshots / moodboard files attached to the prompt
#
# Run it in the background and read <out.md> when it exits.
set -euo pipefail

effort=${1:?effort}; brief=${2:?brief}; out=${3:?out}; shift 3
case "$effort" in high|xhigh|max|ultra) ;; *) echo "bad effort: $effort" >&2; exit 2;; esac
[[ -f "$brief" ]] || { echo "no brief: $brief" >&2; exit 2; }

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
codex login status >/dev/null 2>&1 || { echo "codex not logged in: user must run 'codex login'" >&2; exit 3; }

images=()
for img in "$@"; do [[ -f "$img" ]] && images+=(-i "$img") || echo "skip missing image: $img" >&2; done

# Explicit model, effort and read-only sandbox on every run: the user's global config
# defaults to danger-full-access and a lower effort. Never fast mode, never bypass flags.
# The prompt goes in via stdin ("-"), which also closes stdin so codex cannot hang on it.
codex exec \
  --cd "$repo" \
  --model gpt-6.1-sol \
  --config model_reasoning_effort="$effort" \
  --sandbox read-only \
  --ephemeral \
  --output-last-message "$out" \
  "${images[@]}" \
  -- - < "$brief" > "${out%.md}.log" 2>&1

echo "review written: $out"
