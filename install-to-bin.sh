#!/bin/bash

# Install Enhanced Bear CLI to User Binary Folder
# ===============================================

set -e

echo "🐻 Installing Enhanced Bear CLI to ~/.local/bin"
echo "=============================================="
echo

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BEAR_CLI_NAME="bear"

# Ensure install directory exists
mkdir -p "$INSTALL_DIR"

# Build the project
echo -e "${BLUE}🔨 Building project...${NC}"
cd "$SCRIPT_DIR"
npm run prepack > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Build had warnings, but continuing...${NC}"
fi

echo -e "${GREEN}✅ Build completed${NC}"

# Create wrapper script
echo -e "${BLUE}📝 Creating wrapper script...${NC}"

cat > "$INSTALL_DIR/$BEAR_CLI_NAME" << EOF
#!/bin/bash
# Enhanced Bear CLI Wrapper
# Auto-generated - do not edit directly

BEAR_CLI_DIR="$SCRIPT_DIR"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    echo "Please install Node.js (>=14.0.0) from https://nodejs.org/"
    exit 1
fi

# Run the Bear CLI
exec node "\$BEAR_CLI_DIR/bin/run" "\$@"
EOF

# Make it executable
chmod +x "$INSTALL_DIR/$BEAR_CLI_NAME"

echo -e "${GREEN}✅ Wrapper script created${NC}"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo
    echo -e "${YELLOW}⚠️  Warning: $INSTALL_DIR is not in your PATH${NC}"
    echo
    echo "Add this line to your ~/.zshrc or ~/.bashrc:"
    echo -e "${BLUE}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo
    echo "Then restart your terminal or run:"
    echo -e "${BLUE}source ~/.zshrc${NC}"
    echo
fi

# Test the installation
echo -e "${BLUE}🧪 Testing installation...${NC}"

if "$INSTALL_DIR/$BEAR_CLI_NAME" --version > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Installation successful!${NC}"
    echo
    echo -e "${GREEN}🎉 Bear CLI is now installed!${NC}"
    echo
    echo "Usage:"
    echo "  $BEAR_CLI_NAME --help                              # Show help"
    echo "  $BEAR_CLI_NAME update \"Content\" --title \"Note\"    # Update note"
    echo "  $BEAR_CLI_NAME add-text \"Text\" --creation-date    # Add with timestamp"
    echo "  $BEAR_CLI_NAME search \"term\" --detect-embedded    # Enhanced search"
    echo
    echo "Enhanced features available:"
    echo "  --creation-date    Add creation date with timestamp"
    echo "  --add-id           Include note ID as HTML comment"
    echo "  --content-file     Read content from file"
    echo "  --detect-embedded  Detect embedded note IDs"
    echo
    echo -e "${BLUE}Installed at: $INSTALL_DIR/$BEAR_CLI_NAME${NC}"
else
    echo -e "${YELLOW}⚠️  Installation completed but test failed${NC}"
    echo "You may need to add $INSTALL_DIR to your PATH"
    exit 1
fi
