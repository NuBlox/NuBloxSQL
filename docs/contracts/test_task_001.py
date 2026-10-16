#!/usr/bin/env python3
"""Contract tests for G0 TASK-001; no database-runtime qualification implied."""
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
def read(path):
    return json.loads((ROOT / path).read_text())

inventory_schema = read("database-inventory-v1.schema.json")
error_schema = read("database-operation-error-v1.schema.json")
for schema in (inventory_schema, error_schema):
    Draft202012Validator.check_schema(schema)

validator = Draft202012Validator(inventory_schema, format_checker=FormatChecker())
for path in ("examples/inventory-success.json", "examples/inventory-partial.json"):
    validator.validate(read(path))
for path in ("examples/inventory-invalid-secret.json", "examples/inventory-invalid-accessibility.json"):
    errors = list(validator.iter_errors(read(path)))
    assert errors, f"Invalid fixture was accepted: {path}"

valid = read("examples/inventory-success.json")
assert valid["status"] == "completed" and not valid["capture"]["truncated"]
assert valid["capture"]["visibilityRule"] == "connect-privilege-and-datallowconn"
partial = read("examples/inventory-partial.json")
assert partial["status"] == "partial" and partial["capture"]["truncated"]
assert len(partial["databases"]) <= partial["capture"]["maxDatabases"]
assert [r["name"] for r in valid["databases"]] == sorted(r["name"] for r in valid["databases"])
assert [r["name"] for r in partial["databases"]] == sorted(r["name"] for r in partial["databases"])

error_validator = Draft202012Validator(error_schema, format_checker=FormatChecker())
error_validator.validate(read("examples/error-auth-failed.json"))
bad = read("examples/error-auth-failed.json")
bad["connectionString"] = "postgres://user:secret@localhost/test"
assert list(error_validator.iter_errors(bad)), "Error contract leaked an unallowlisted field"
bad = read("examples/inventory-success.json")
bad["warnings"] = [{"code": "PERMISSION_SCOPE", "message": "Scope limited"}]
assert list(validator.iter_errors(bad)), "Completed with incomplete warnings was accepted"
bad = read("examples/inventory-success.json")
bad["capture"]["truncated"] = True
assert list(validator.iter_errors(bad)), "Truncated completed inventory was accepted"

print("TASK-001 JSON Schema: valid/partial/error fixtures PASS; secret, semantics and scope negatives PASS")
