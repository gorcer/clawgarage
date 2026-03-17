#!/bin/bash
# Generate skill archive for ClawGarage

SKILL_DIR="$(dirname "$0")/skill"
OUTPUT_DIR="$(dirname "$0")"

cd "$SKILL_DIR" || exit 1

# Create zip archive
zip -r "$OUTPUT_DIR/clawgarage-skill.zip" .

echo "Created: $OUTPUT_DIR/clawgarage-skill.zip"
