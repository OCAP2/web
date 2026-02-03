#!/bin/bash
# Migration script: Strip .json suffix from filenames
# Run this once after upgrading from old naming convention
#
# Old: DB stores "foo.json", output dirs as "foo.json/"
# New: DB stores "foo", output dirs as "foo/"

set -e

DB="${OCAP_DB:-data.db}"
DATA_DIR="${OCAP_DATA:-data}"

# Check sqlite3 is available
if ! command -v sqlite3 &> /dev/null; then
    echo "Error: sqlite3 is required"
    exit 1
fi

# Check database exists
if [ ! -f "$DB" ]; then
    echo "Error: Database not found: $DB"
    echo "Set OCAP_DB to your database path"
    exit 1
fi

echo "Migrating database: $DB"
echo "Data directory: $DATA_DIR"
echo

# Count affected rows
COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM operations WHERE filename LIKE '%.json'")
echo "Found $COUNT filenames with .json suffix"

if [ "$COUNT" -eq 0 ]; then
    echo "Nothing to migrate in database"
else
    # Update database
    sqlite3 "$DB" "UPDATE operations SET filename = SUBSTR(filename, 1, LENGTH(filename) - 5) WHERE filename LIKE '%.json'"
    echo "Database updated"
fi

# Rename output directories
if [ -d "$DATA_DIR" ]; then
    RENAMED=0
    for dir in "$DATA_DIR"/*.json; do
        [ -d "$dir" ] || continue
        newdir="${dir%.json}"
        if [ -d "$newdir" ]; then
            echo "Warning: Both exist, skipping: $dir -> $newdir"
        else
            mv "$dir" "$newdir"
            echo "Renamed: $dir -> $newdir"
            ((RENAMED++))
        fi
    done
    echo "Renamed $RENAMED directories"
else
    echo "Data directory not found: $DATA_DIR"
fi

echo
echo "Migration complete"
