"""Test json_to_sql.py with mock data."""
import json
import subprocess

data = {
    "ok": True,
    "refereeName": "Test Referee",
    "matchesCount": 100,
    "avgYellowCards": 4.5,
    "avgRedCards": 0.1,
    "avgFouls": 22.0,
    "avgPenalties": 0.3,
    "penaltyRate": 0.3,
    "cardRate": 4.5,
}
result = subprocess.run(
    ["python3", "scripts/json_to_sql.py"],
    input=json.dumps(data),
    capture_output=True,
    text=True,
    cwd=".",
)
print("STDOUT:")
print(result.stdout)
print("STDERR:")
print(result.stderr)
print("Return code:", result.returncode)
