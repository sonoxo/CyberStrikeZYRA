#!/usr/bin/env bash
set -euo pipefail

REPO="${CYBERSTRIKE_REPO:-$HOME/CyberStrikeZYRA}"
SRC="$REPO/packages/target-defense/redbutton.mjs"
BIN_DIR="$HOME/.local/bin"
ZSHRC="$HOME/.zshrc"

if [ ! -f "$SRC" ]; then
  echo "❌ RedButton launcher not found at: $SRC"
  echo "Run: cd \"$REPO\" && git pull --ff-only"
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$SRC"

cat > "$BIN_DIR/RedButton" <<EOF
#!/usr/bin/env bash
exec node "$SRC" "\$@"
EOF
chmod +x "$BIN_DIR/RedButton"
ln -sf "$BIN_DIR/RedButton" "$BIN_DIR/redbutton"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$ZSHRC" 2>/dev/null; then
  printf '\n# XUNIA RedButton\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$ZSHRC"
fi

export PATH="$HOME/.local/bin:$PATH"

echo "✅ RedButton installed"
echo "   $BIN_DIR/RedButton"
echo "   $BIN_DIR/redbutton"
echo
printf 'Run now:  RedButton status\n'
printf 'Open:     RedButton\n'
printf 'Target:   RedButton xunia-local\n'
