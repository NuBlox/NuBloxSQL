-- Real MySQL 8.4.11 fixtures; install through mysql CLI in isolated CI only.
DROP PROCEDURE IF EXISTS nublox_test.nublox_multi_result;
DROP PROCEDURE IF EXISTS nublox_test.nublox_many_result;
DROP PROCEDURE IF EXISTS nublox_test.nublox_out_result;
DROP PROCEDURE IF EXISTS nublox_test.nublox_memory_results;
DELIMITER $$
CREATE PROCEDURE nublox_test.nublox_multi_result(IN p BIGINT)
BEGIN
  SELECT p AS initial_value, 'first' AS label;
  SELECT p + 1 AS second_value;
END$$
CREATE PROCEDURE nublox_test.nublox_many_result()
BEGIN
  DECLARE i INT DEFAULT 0;
  WHILE i < 40 DO
    SELECT i AS iteration;
    SET i = i + 1;
  END WHILE;
END$$
CREATE PROCEDURE nublox_test.nublox_out_result(IN p BIGINT, OUT q BIGINT)
BEGIN
  SELECT p AS input_value;
  SET q = p + 7;
END$$
-- Read-only, bounded large multi-result memory-recovery qualification fixture.
-- The server rejects uncontrolled input even if the caller misconfigures CI.
CREATE PROCEDURE nublox_test.nublox_memory_results(IN p_rows INT, IN p_bytes INT)
BEGIN
  IF p_rows IS NULL OR p_bytes IS NULL OR p_rows NOT BETWEEN 1 AND 500
     OR p_bytes NOT BETWEEN 1 AND 4096 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid memory fixture dimensions';
  END IF;
  WITH RECURSIVE sequence_rows(n) AS (
    SELECT 0
    UNION ALL
    SELECT n+1 FROM sequence_rows WHERE n+1 < p_rows
  )
  SELECT n AS ordinal, REPEAT('x',p_bytes) AS text_value
  FROM sequence_rows ORDER BY n;
  WITH RECURSIVE sequence_rows(n) AS (
    SELECT 0
    UNION ALL
    SELECT n+1 FROM sequence_rows WHERE n+1 < p_rows
  )
  SELECT n AS ordinal, CAST(REPEAT('y',p_bytes) AS BINARY) AS binary_value
  FROM sequence_rows ORDER BY n;
END$
DELIMITER ;
