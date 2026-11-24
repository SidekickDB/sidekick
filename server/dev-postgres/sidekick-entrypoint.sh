#!/bin/sh
# SidekickDB: PostgreSQL 17.12 and later refuse an output plugin that is not
# listed in output_plugin_libraries, and the server's replication slots use
# wal2json. Add the setting whatever command the container is started with,
# so it also holds for the compose files' own command and for a data
# directory created by an older image. A later -c on the command line wins.
set -e

allow="output_plugin_libraries=pgoutput,test_decoding,wal2json"

if [ "$1" = "postgres" ]; then
  shift
  set -- postgres -c "$allow" "$@"
elif [ "${1#-}" != "$1" ]; then
  set -- postgres -c "$allow" "$@"
fi

exec docker-entrypoint.sh "$@"
