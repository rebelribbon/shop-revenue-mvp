#!/usr/bin/env bash
# Start the local Supabase stack (Section 23 "Local"): Postgres, Auth, Storage, Mailpit.
#
# Codespaces quirk: the host carries stale iptables-legacy rules with FORWARD DROP
# that only allow docker0, so containers on Supabase's user-defined bridge cannot
# reach each other (auth/storage go unhealthy). The rules do not survive a restart,
# so re-add an accept rule for br-* bridges each time. Local machine only.
set -euo pipefail
if command -v iptables-legacy >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  for dir in -i -o; do
    sudo iptables-legacy -C FORWARD "$dir" br-+ -j ACCEPT 2>/dev/null \
      || sudo iptables-legacy -I FORWARD 1 "$dir" br-+ -j ACCEPT
  done
fi
supabase stop >/dev/null 2>&1 || true
exec supabase start -x vector,logflare,imgproxy,postgres-meta,studio,realtime,edge-runtime,supavisor,postgrest
