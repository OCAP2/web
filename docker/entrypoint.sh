#!/bin/sh

# Pelican/Wings compatibility: if STARTUP is set, process and eval it.
# Otherwise, run the app directly for standalone Docker usage.
if [ -n "$STARTUP" ]; then
    cd /home/container || exit 1

    # Pelican/Wings injects SERVER_PORT with the allocated port.
    # Use it for OCAP_LISTEN since {{}} templates in env var defaults
    # may not be resolved by all Pelican versions.
    if [ -n "$SERVER_PORT" ]; then
        export OCAP_LISTEN="0.0.0.0:${SERVER_PORT}"
    fi

    MODIFIED_STARTUP=$(echo "$STARTUP" | sed -e 's/{{/${/g' -e 's/}}/}/g')
    echo ":/home/container$ $MODIFIED_STARTUP"

    eval "$MODIFIED_STARTUP"
else
    exec /usr/local/ocap/app "$@"
fi
