#!/bin/sh

# Auto-detect maptool capability: if tippecanoe is installed (full variant),
# enable maptool unless explicitly disabled via OCAP_MAPTOOL_ENABLED=false.
if [ -z "$OCAP_MAPTOOL_ENABLED" ] && command -v tippecanoe >/dev/null 2>&1; then
    export OCAP_MAPTOOL_ENABLED=true
fi

# Pelican/Wings compatibility: if STARTUP is set, process and eval it.
# Otherwise, run the app directly for standalone Docker usage.
if [ -n "$STARTUP" ]; then
    cd /home/container || exit 1

    MODIFIED_STARTUP=$(echo "$STARTUP" | sed -e 's/{{/${/g' -e 's/}}/}/g')
    echo ":/home/container$ $MODIFIED_STARTUP"

    eval "$MODIFIED_STARTUP"
else
    exec /usr/local/ocap/app "$@"
fi
