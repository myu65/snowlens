-- Run after setup.sql. Replace SNOWFLAKE_APPS with the deployment database.
-- This procedure must be owned by a dedicated PRIVATE_STORAGE_OWNER role with
-- DML only on METADATA/PERSONAL_TABLES. It needs no business data or Dataset grants.
-- Do not grant this owner role to explorers, Dataset editors or the runtime role.
CREATE OR REPLACE PROCEDURE SNOWFLAKE_APPS.APP.WRITE_PRIVATE_STATE(
  ACTION VARCHAR, ITEM_ID VARCHAR, BODY VARCHAR, EXPECTED_VERSION NUMBER
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  actor VARCHAR DEFAULT SNOWFLAKE_APPS.APP.CURRENT_PRINCIPAL();
  document VARIANT;
  affected NUMBER;
  owned_count NUMBER;
  invalid_input EXCEPTION (-20001, 'Invalid private state');
  version_conflict EXCEPTION (-20002, '個人テーブルが更新されています。画面を再読み込みしてください。');
BEGIN
  IF (actor IS NULL OR ITEM_ID IS NULL OR LENGTH(ITEM_ID) = 0 OR LENGTH(ITEM_ID) > 1000
      OR ACTION IS NULL OR BODY IS NULL OR OCTET_LENGTH(BODY) > 1000000
      OR EXPECTED_VERSION IS NULL OR EXPECTED_VERSION < 0
      OR EXPECTED_VERSION <> FLOOR(EXPECTED_VERSION)
      OR ACTION NOT IN ('saved', 'favorite', 'favorite_delete', 'recent', 'personal', 'personal_delete')) THEN
    RAISE invalid_input;
  END IF;
  document := PARSE_JSON(BODY);
  IF (ACTION = 'personal') THEN
    IF (COALESCE(NOT IS_OBJECT(document) OR document:id::VARCHAR <> ITEM_ID
        OR LENGTH(ITEM_ID) > 80 OR OCTET_LENGTH(BODY) > 500000
        OR NOT IS_ARRAY(document:columns) OR ARRAY_SIZE(document:columns) NOT BETWEEN 1 AND 12
        OR NOT IS_ARRAY(document:rows) OR ARRAY_SIZE(document:rows) > 1000, TRUE)) THEN
      RAISE invalid_input;
    END IF;
    document := OBJECT_INSERT(document, 'version', EXPECTED_VERSION + 1, TRUE);
  ELSEIF (ACTION = 'saved') THEN
    IF (COALESCE(NOT IS_OBJECT(document) OR document:id::VARCHAR <> ITEM_ID
        OR LENGTH(ITEM_ID) > 80 OR NOT IS_OBJECT(document:query), TRUE)) THEN
      RAISE invalid_input;
    END IF;
  ELSEIF (ACTION IN ('favorite', 'recent')) THEN
    IF (COALESCE(NOT IS_VARCHAR(document) OR document::VARCHAR <> ITEM_ID, TRUE)) THEN
      RAISE invalid_input;
    END IF;
  END IF;

  BEGIN TRANSACTION;
  IF (ACTION = 'personal') THEN
    IF (EXPECTED_VERSION = 0) THEN
      SELECT COUNT(*) INTO :owned_count FROM SNOWFLAKE_APPS.APP.PERSONAL_TABLES
        WHERE OWNER = :actor;
      IF (owned_count >= 50) THEN RAISE invalid_input; END IF;
      INSERT INTO SNOWFLAKE_APPS.APP.PERSONAL_TABLES (OWNER, KIND, ID, PAYLOAD, UPDATED_AT)
        SELECT :actor, 'personal', :ITEM_ID, :document, CURRENT_TIMESTAMP()
        WHERE NOT EXISTS (SELECT 1 FROM SNOWFLAKE_APPS.APP.PERSONAL_TABLES
          WHERE OWNER = :actor AND KIND = 'personal' AND ID = :ITEM_ID);
      affected := SQLROWCOUNT;
    ELSE
      UPDATE SNOWFLAKE_APPS.APP.PERSONAL_TABLES SET PAYLOAD = :document, UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE OWNER = :actor AND KIND = 'personal' AND ID = :ITEM_ID
          AND PAYLOAD:version::NUMBER = :EXPECTED_VERSION;
      affected := SQLROWCOUNT;
    END IF;
    IF (affected <> 1) THEN RAISE version_conflict; END IF;
  ELSEIF (ACTION = 'personal_delete') THEN
    DELETE FROM SNOWFLAKE_APPS.APP.PERSONAL_TABLES
      WHERE OWNER = :actor AND KIND = 'personal' AND ID = :ITEM_ID
        AND PAYLOAD:version::NUMBER = :EXPECTED_VERSION;
    affected := SQLROWCOUNT;
    IF (affected <> 1) THEN RAISE version_conflict; END IF;
  ELSEIF (ACTION = 'favorite_delete') THEN
    DELETE FROM SNOWFLAKE_APPS.APP.METADATA
      WHERE OWNER = :actor AND KIND = 'favorite' AND ID = :ITEM_ID;
  ELSE
    MERGE INTO SNOWFLAKE_APPS.APP.METADATA t
      USING (SELECT :actor OWNER, :ACTION KIND, :ITEM_ID ID, :document PAYLOAD) s
      ON t.OWNER = s.OWNER AND t.KIND = s.KIND AND t.ID = s.ID
      WHEN MATCHED THEN UPDATE SET PAYLOAD = s.PAYLOAD, UPDATED_AT = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (OWNER, KIND, ID, PAYLOAD, UPDATED_AT)
        VALUES (s.OWNER, s.KIND, s.ID, s.PAYLOAD, CURRENT_TIMESTAMP());
    IF (ACTION = 'recent') THEN
      DELETE FROM SNOWFLAKE_APPS.APP.METADATA
        WHERE OWNER = :actor AND KIND = 'recent' AND ID NOT IN (
          SELECT ID FROM SNOWFLAKE_APPS.APP.METADATA WHERE OWNER = :actor AND KIND = 'recent'
          ORDER BY UPDATED_AT DESC, ID LIMIT 20);
    END IF;
  END IF;
  COMMIT;
  RETURN OBJECT_CONSTRUCT('version', EXPECTED_VERSION + 1);
EXCEPTION
  WHEN OTHER THEN
    ROLLBACK;
    RAISE;
END;
$$;

-- Admin: transfer ownership to the narrow storage role after granting its DML.
-- GRANT USAGE ON DATABASE SNOWFLAKE_APPS TO ROLE <PRIVATE_STORAGE_OWNER_ROLE>;
-- GRANT USAGE ON SCHEMA SNOWFLAKE_APPS.APP TO ROLE <PRIVATE_STORAGE_OWNER_ROLE>;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE SNOWFLAKE_APPS.APP.METADATA TO ROLE <PRIVATE_STORAGE_OWNER_ROLE>;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE SNOWFLAKE_APPS.APP.PERSONAL_TABLES TO ROLE <PRIVATE_STORAGE_OWNER_ROLE>;
-- GRANT OWNERSHIP ON PROCEDURE SNOWFLAKE_APPS.APP.WRITE_PRIVATE_STATE(VARCHAR, VARCHAR, VARCHAR, NUMBER)
--   TO ROLE <PRIVATE_STORAGE_OWNER_ROLE> COPY CURRENT GRANTS;
-- GRANT USAGE ON PROCEDURE SNOWFLAKE_APPS.APP.WRITE_PRIVATE_STATE(VARCHAR, VARCHAR, VARCHAR, NUMBER) TO ROLE <EXPLORER_ROLE>;
-- GRANT CALLER USAGE ON PROCEDURE SNOWFLAKE_APPS.APP.WRITE_PRIVATE_STATE(VARCHAR, VARCHAR, VARCHAR, NUMBER) TO ROLE <SERVICE_OWNER_ROLE>;
-- For upgrades: REVOKE previous direct INSERT/UPDATE/DELETE on both private tables
-- from explorer/runtime roles, including inherited grants. Do not deploy with them.
-- Verify actual caller identity, transaction conflicts, owner isolation and nested
-- owner-rights behavior in App Runtime before production rollout (Issue #5).
