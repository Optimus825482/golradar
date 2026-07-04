#!/usr/bin/env python3
"""Understat HTML structure inspector."""
import urllib.request, json, re, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://understat.com/league/EPL/2024"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
r = urllib.request.urlopen(req, timeout=20, context=ctx)
html = r.read().decode("utf-8")

# 1. What script tags contain data?
scripts = re.findall(r'<script[^>]*>([^<]+?)</script>', html, re.DOTALL)
print(f"Total script tags: {len(scripts)}")
for i, s in enumerate(scripts):
    if len(s) > 200 and ('date' in s.lower() or 'team' in s.lower() or 'xG' in s or 'goal' in s.lower()):
        print(f"\n--- Script {i} ({len(s)} chars) ---")
        print(s[:300])
        print("...")
        print(s[-200:])

# 2. Look for inline JSON in HTML body
json_patterns = re.findall(r'(?:var|let|const)\s+(\w+)\s*=\s*(\[.*?\])\s*;', html, re.DOTALL)
print(f"\n--- Inline JSON arrays ({len(json_patterns)}) ---")
for name, val in json_patterns[:5]:
    print(f"  {name}: {val[:100]}...")

# 3. Look for React data attributes
react_data = re.findall(r'data-(?:json|data|props)="([^"]+)"', html)
print(f"\n--- React data attributes: {len(react_data)} ---")
for d in react_data[:3]:
    print(f"  {d[:200]}")
