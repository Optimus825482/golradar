#!/usr/bin/env python3
"""Quick test: fetch Premier League CSV from Football-Data.co.uk"""
import urllib.request
import sys

url = "https://www.football-data.co.uk/mmz4281/2324/E0.csv"
try:
    r = urllib.request.urlopen(url, timeout=15)
    data = r.read().decode("utf-8-sig")
    lines = data.strip().split("\n")
    print(f"OK: {len(lines)} rows, {len(lines[0].split(','))} columns")
    print(f"Headers: {lines[0]}")
    print(f"\nFirst row: {lines[1]}")
    print(f"Last row:  {lines[-1]}")
except Exception as e:
    print(f"FAIL: {e}")
