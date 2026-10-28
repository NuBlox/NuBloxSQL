-- Disposable CI fixture only. Never install in a customer or shared database.
-- Identity is deliberately unprivileged and has no write, DDL, FILE, or
-- administrative permissions. Test password has no production use.
CREATE TABLE IF NOT EXISTS nublox_test.nublox_least_privilege_fixture (
  id INT NOT NULL PRIMARY KEY,
  value VARCHAR(60) NOT NULL
);
INSERT INTO nublox_test.nublox_least_privilege_fixture (id, value)
VALUES (1, 'approved-read-only-test-row')
ON DUPLICATE KEY UPDATE value=VALUES(value);
CREATE USER 'nubloxsql_readonly'@'%' IDENTIFIED WITH caching_sha2_password
  BY 'nublox-test-readonly-credential';
GRANT SELECT ON nublox_test.* TO 'nubloxsql_readonly'@'%';
