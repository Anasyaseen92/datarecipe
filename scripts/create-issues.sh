#!/usr/bin/env bash
# Create the contributor issues listed in ISSUES.md on GitHub.
#
#   bash scripts/create-issues.sh --dry-run   # show what would be created
#   bash scripts/create-issues.sh             # create labels and issues
#
# Needs the GitHub CLI (https://cli.github.com), logged in with `gh auth login`,
# run from a clone of the repo. Each "## N. Title" section in ISSUES.md becomes
# one issue; its "**Labels:**" line sets the labels.
set -euo pipefail
cd "$(dirname "$0")/.."

dry_run=0
[[ "${1:-}" == "--dry-run" ]] && dry_run=1

if [[ $dry_run == 0 ]]; then
  command -v gh >/dev/null || { echo "Error: install the GitHub CLI first: https://cli.github.com" >&2; exit 1; }
  # --force updates a label that already exists instead of failing.
  gh label create "good first issue" --color 7057ff --description "Good for newcomers" --force
  gh label create "help wanted" --color 008672 --description "Extra attention is needed" --force
  gh label create "recipe" --color 0e8a16 --description "Recipe files in recipes/" --force
  gh label create "output" --color 1d76db --description "Output formats and destinations" --force
  gh label create "olostep" --color f9a03f --description "Uses another Olostep feature" --force
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Split ISSUES.md into one file per "## N. Title" section (the intro is skipped).
awk -v dir="$tmp" '/^## [0-9]+\. /{ n++; file = sprintf("%s/%02d.md", dir, n) } n { print > file }' ISSUES.md

count=0
for section in "$tmp"/*.md; do
  title="$(head -n 1 "$section" | sed -E 's/^## [0-9]+\. //')"
  labels="$(grep -m 1 '^\*\*Labels:\*\*' "$section" | sed -E 's/^\*\*Labels:\*\* *//; s/`//g')"
  body="$section.body"
  tail -n +2 "$section" | grep -v '^\*\*Labels:\*\*' > "$body"

  args=(--title "$title" --body-file "$body")
  IFS=',' read -ra parts <<< "$labels"
  for label in "${parts[@]}"; do
    label="$(echo "$label" | sed -E 's/^ +| +$//g')"
    [[ -n "$label" ]] && args+=(--label "$label")
  done

  if [[ $dry_run == 1 ]]; then
    echo "Would create: $title  [labels: $labels]"
  else
    gh issue create "${args[@]}"
  fi
  count=$((count + 1))
done

echo "$([[ $dry_run == 1 ]] && echo "Dry run: $count issues" || echo "Created $count issues")."
