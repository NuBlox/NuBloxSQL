#!/usr/bin/env bash
# Ephemeral integration-test certificates: never commit generated private keys.
set -euo pipefail

: "${RUNNER_TEMP:?This fixture runs in the GitHub Actions runner}"
TLS_DIR="${RUNNER_TEMP}/nubloxsql-mysql-tls"
mkdir -p "${TLS_DIR}"
chmod 700 "${TLS_DIR}"
cd "${TLS_DIR}"

# Use a dedicated short-lived CA and a distinct server identity.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
  -subj "/CN=NuBloxSQL Test Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.pem >/dev/null 2>&1

openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -subj "/CN=localhost" \
  -keyout server.key -out server.csr >/dev/null 2>&1

cat > server.ext <<'EOF'
basicConstraints=critical,CA:FALSE
subjectAltName=DNS:localhost,IP:127.0.0.1
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF

openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key \
  -CAcreateserial -sha256 -days 2 -extfile server.ext \
  -out server.pem >/dev/null 2>&1

# This independent CA must fail trust validation in the client.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
  -subj "/CN=Unrelated NuBloxSQL Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout unrelated.key -out unrelated-ca.pem >/dev/null 2>&1

# The image starts mysqld as its mysql account. Only that account may read
# the test server's private key; avoid world-readable credentials.
MYSQL_UID="$(docker run --rm --entrypoint id mysql:8.4.11 -u mysql)"
sudo chown "${MYSQL_UID}" server.key
chmod 600 server.key
chmod 644 ca.pem server.pem unrelated-ca.pem

docker run --detach --name nubloxsql-mysql-tls \
  --publish 127.0.0.1:3307:3306 \
  --mount "type=bind,src=${TLS_DIR},dst=/etc/mysql/tls,readonly" \
  --env MYSQL_ROOT_PASSWORD=test-password \
  --env MYSQL_DATABASE=nublox_test \
  mysql:8.4.11 \
  --ssl-ca=/etc/mysql/tls/ca.pem \
  --ssl-cert=/etc/mysql/tls/server.pem \
  --ssl-key=/etc/mysql/tls/server.key \
  --require-secure-transport=ON

ready=0
for i in $(seq 1 90); do
  if docker exec nubloxsql-mysql-tls mysql --protocol=socket \
      --user=root --password=test-password --batch --skip-column-names \
      -e "SELECT @@global.require_secure_transport, @@global.have_ssl;" 2>/dev/null \
      | grep -Eq '^1[[:space:]]+YES; then
    if (echo > /dev/tcp/127.0.0.1/3307) 2>/dev/null; then
      ready=1
      break
    fi
  fi
  sleep 2
done

if [[ "${ready}" != 1 ]]; then
  docker logs nubloxsql-mysql-tls
  echo 'MySQL 8.4 TLS fixture did not become ready' >&2
  exit 1
fi

echo "NUBLOX_TLS_CA_FILE=${TLS_DIR}/ca.pem" >> "${GITHUB_ENV}"
echo "NUBLOX_TLS_OTHER_CA_FILE=${TLS_DIR}/unrelated-ca.pem" >> "${GITHUB_ENV}"
echo 'MySQL 8.4 TLS-required fixture is ready'
; then
    if (echo > /dev/tcp/127.0.0.1/3307) 2>/dev/null; then
      ready=1
      break
    fi
  fi
  sleep 2
done

if [[ "${ready}" != 1 ]]; then
  docker logs nubloxsql-mysql-tls
  echo 'MySQL 8.4 TLS fixture did not become ready' >&2
  exit 1
fi

echo "NUBLOX_TLS_CA_FILE=${TLS_DIR}/ca.pem" >> "${GITHUB_ENV}"
echo "NUBLOX_TLS_OTHER_CA_FILE=${TLS_DIR}/unrelated-ca.pem" >> "${GITHUB_ENV}"
echo 'MySQL 8.4 TLS-required fixture is ready'
