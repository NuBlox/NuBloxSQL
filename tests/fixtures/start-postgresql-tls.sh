#!/usr/bin/env bash
# Ephemeral PostgreSQL 17 TLS fixture; never uses production databases or keys.
set -euo pipefail

cert_dir="$RUNNER_TEMP/nubloxsql-tls-fixture"
mkdir -p "$cert_dir"
chmod 755 "$cert_dir"
umask 077

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
  -subj '/CN=NuBloxSQL Disposable Test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.crt"

openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=localhost' \
  -keyout "$cert_dir/server.key" -out "$cert_dir/server.csr"

cat > "$cert_dir/server.ext" <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF

openssl x509 -req -in "$cert_dir/server.csr" \
  -CA "$cert_dir/ca.crt" -CAkey "$cert_dir/ca.key" \
  -CAcreateserial -days 2 -sha256 \
  -extfile "$cert_dir/server.ext" -out "$cert_dir/server.crt"

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
  -subj '/CN=NuBloxSQL Untrusted Test CA' \
  -keyout "$cert_dir/untrusted.key" -out "$cert_dir/untrusted.crt"

chmod 644 "$cert_dir/ca.crt" "$cert_dir/server.crt" "$cert_dir/untrusted.crt"
chmod 600 "$cert_dir/server.key"
# The official Debian-based PostgreSQL image uses postgres UID/GID 999.
sudo chown 999:999 "$cert_dir/server.key"

image='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
docker run --rm -d --name nubloxsql-pg-verified-tls \
  -p 127.0.0.1:5433:5432 \
  -v "$cert_dir:/certs:ro" \
  -e POSTGRES_PASSWORD=ci-fixture-admin-only \
  "$image" \
  -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key

ready=0
for attempt in $(seq 1 45); do
  if docker exec nubloxsql-pg-verified-tls \
      pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  docker logs --tail 40 nubloxsql-pg-verified-tls
  exit 1
fi

{
  printf 'NUBLOXSQL_CI_TLS_CA_FILE=%s\n' "$cert_dir/ca.crt"
  printf 'NUBLOXSQL_CI_TLS_UNTRUSTED_CA_FILE=%s\n' "$cert_dir/untrusted.crt"
} >> "$GITHUB_ENV"

echo 'Ephemeral verified-TLS PostgreSQL 17 fixture is ready.'
