#!/usr/bin/env bash
# Ephemeral integration-test certificates: never commit generated private keys.
set -euo pipefail

: "${RUNNER_TEMP:?This fixture runs in the GitHub Actions runner}"
: "${GITHUB_ENV:?This fixture requires the GitHub Actions environment file}"
# Restrict the image choice to qualified, explicit, immutable version tags.
# The existing MySQL 8.4 driver workflow works without an override.
MYSQL_TLS_VERSION="${NUBLOX_TEST_MYSQL_VERSION:-8.4.11}"
case "${MYSQL_TLS_VERSION}" in
  8.0.44|8.4.11|8.4.13|9.7.4) ;;
  *) echo "Unsupported TLS qualification MySQL image version" >&2; exit 1 ;;
esac
MYSQL_TLS_IMAGE="mysql:${MYSQL_TLS_VERSION}"
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
MYSQL_UID="$(docker run --rm --entrypoint id "${MYSQL_TLS_IMAGE}" -u mysql)"
chmod 600 server.key
sudo chown "${MYSQL_UID}" server.key
chmod 644 ca.pem server.pem unrelated-ca.pem
# The container's mysql user must traverse the bind-mounted certificate directory.
# CA private keys remain owner-only inside this ephemeral runner directory.
chmod 755 "${TLS_DIR}"

docker run --detach --name nubloxsql-mysql-tls \
  --publish 127.0.0.1:3307:3306 \
  --mount "type=bind,src=${TLS_DIR},dst=/etc/mysql/tls,readonly" \
  --env MYSQL_ROOT_PASSWORD=test-password \
  --env MYSQL_DATABASE=nublox_test \
  "${MYSQL_TLS_IMAGE}" \
  --ssl-ca=/etc/mysql/tls/ca.pem \
  --ssl-cert=/etc/mysql/tls/server.pem \
  --ssl-key=/etc/mysql/tls/server.key \
  --require-secure-transport=ON

# Probe the authenticated, TLS-enabled final TCP server, not the temporary
# socket-only initialization server or Docker's published port listener.
ready=0
for i in $(seq 1 90); do
  if docker exec -e MYSQL_PWD=test-password nubloxsql-mysql-tls \
      mysql --protocol=tcp --host=127.0.0.1 --ssl-mode=REQUIRED \
      --user=root --batch --skip-column-names \
      -e "SELECT @@global.require_secure_transport;" 2>/dev/null \
      | grep -Fqx 1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "${ready}" != 1 ]]; then
  docker logs nubloxsql-mysql-tls
  echo 'MySQL ${MYSQL_TLS_VERSION} TLS fixture did not become ready' >&2
  exit 1
fi

echo "NUBLOX_TLS_CA_FILE=${TLS_DIR}/ca.pem" >> "${GITHUB_ENV}"
echo "NUBLOX_TLS_OTHER_CA_FILE=${TLS_DIR}/unrelated-ca.pem" >> "${GITHUB_ENV}"
echo "MySQL ${MYSQL_TLS_VERSION} TLS-required fixture is ready"
