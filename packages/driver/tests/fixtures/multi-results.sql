-- Real MySQL 8.4.11 fixtures; install through mysql CLI in isolated CI only.
DROP PROCEDURE IF EXISTS nublox_test.nublox_multi_result;
DROP PROCEDURE IF EXISTS nublox_test.nublox_many_result;
DROP PROCEDURE IF EXISTS nublox_test.nublox_out_result;
DELIMITER $$
CREATE PROCEDURE nublox_test.nublox_multi_result(IN p BIGINT)
BEGIN
  SELECT p AS first_value, 'first' AS label;
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
DELIMITER ;
