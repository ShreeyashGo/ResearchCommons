#!/usr/bin/env bash
set -euo pipefail

status_output="$(supabase status -o env)"

get_value() {
  local key="$1"

  awk -v key="$key" '
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      separator = index(line, "=")
      if (separator == 0 || substr(line, 1, separator - 1) != key) {
        next
      }

      value = substr(line, separator + 1)
      if (value ~ /^".*"$/) {
        sub(/^"/, "", value)
        sub(/"$/, "", value)
      } else if (value ~ /^'\''.*'\''$/) {
        sub(/^'\''/, "", value)
        sub(/'\''$/, "", value)
      }
      print value
      exit
    }
  ' <<<"$status_output"
}

api_url="$(get_value API_URL)"
api_url="${api_url:-$(get_value SUPABASE_URL)}"
anon_key="$(get_value ANON_KEY)"
anon_key="${anon_key:-$(get_value SUPABASE_ANON_KEY)}"
anon_key="${anon_key:-$(get_value PUBLISHABLE_KEY)}"
service_role_key="$(get_value SERVICE_ROLE_KEY)"
service_role_key="${service_role_key:-$(get_value SUPABASE_SERVICE_ROLE_KEY)}"
service_role_key="${service_role_key:-$(get_value SECRET_KEY)}"

if [[ -z "$api_url" || -z "$anon_key" || -z "$service_role_key" ]]; then
  printf 'Could not find the Supabase API URL and local keys in `supabase status -o env` output.\n' >&2
  exit 1
fi

umask 077
{
  printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n' "$api_url"
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$anon_key"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$service_role_key"
  printf 'AI_PROVIDER=mock\n'
} > .env.local

printf 'Wrote local Supabase settings to .env.local\n'
