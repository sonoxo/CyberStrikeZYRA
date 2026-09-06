#!/usr/bin/env bash
set -euo pipefail

REPO="${CYBERSTRIKE_REPO:-$HOME/CyberStrikeZYRA}"
SRC="$REPO/packages/target-defense/redbutton.mjs"
BIN_DIR="$HOME/.local/bin"
ZSHRC="$HOME/.zshrc"
LAUNCHER="$BIN_DIR/RedButton"

if [ ! -f "$SRC" ]; then
  echo "❌ RedButton launcher not found at: $SRC"
  echo "Run: cd \"$REPO\" && git pull --ff-only"
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$SRC"

# macOS normally uses a case-insensitive filesystem. Creating both RedButton
# and redbutton there can turn the launcher into a self-referencing symlink.
# Remove any previous/broken entry and install exactly one real executable.
rm -f "$BIN_DIR/RedButton" "$BIN_DIR/redbutton" 2>/dev/null || true

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec node "$SRC" "\$@"
EOF
chmod +x "$LAUNCHER"

# Persist PATH for future shells. Do not source .zshrc here; an unrelated
# syntax error in a user's existing shell config must not break installation.
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
if ! grep -Fq "$PATH_LINE" "$ZSHRC" 2>/dev/null; then
  printf '\n# XUNIA RedButton\n%s\n' "$PATH_LINE" >> "$ZSHRC"
fi

# Make the command usable in this installer process and print the one-liner
# needed for the caller's current shell.
export PATH="$HOME/.local/bin:$PATH"

echo "✅ RedButton installed"
echo "   $LAUNCHER"
echo
echo "Current shell activation:"
echo '   export PATH="$HOME/.local/bin:$PATH"'
echo '   rehash'
echo
printf 'Run now:  RedButton status\n'
printf 'Open:     RedButton\n'
printf 'Target:   RedButton xunia-local\n'
