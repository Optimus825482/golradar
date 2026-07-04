#!/usr/bin/env python3
"""Verify training data quality."""
import json, os

path = os.path.join(os.path.dirname(__file__), "..", "data", "ml-models", "training-data.json")
with open(path) as f:
    data = json.load(f)

print(f"Training data: {len(data)} records")
print(f"Feature vector: {len(data[0]['features'])} dimensions" if data else "EMPTY")
print()
print(f"First record: matchCode={data[0].get('matchCode')}, minute={data[0].get('minute')}, label={data[0].get('label')}")
print(f"Sample features: {[round(v,2) for v in data[0]['features'][:10]]}...")

goals = sum(1 for r in data if r["label"] == 1)
nogoals = len(data) - goals
print(f"\nClass balance: {goals} goals, {nogoals} no-goals ({goals/max(1,len(data))*100:.1f}%)")
print(f"Unique matches: {len(set(r['matchCode'] for r in data))}")

# Check recently modified files
ol_path = os.path.join(os.path.dirname(__file__), "..", "data", "ml-training", "openligadb-matches.jsonl")
if os.path.exists(ol_path):
    with open(ol_path) as f:
        count = sum(1 for _ in f)
    print(f"\nOpenLigaDB raw matches: {count}")

# Check training data file size
size_mb = os.path.getsize(path) / (1024*1024)
print(f"Training data file: {size_mb:.1f} MB")
