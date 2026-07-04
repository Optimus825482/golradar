#!/usr/bin/env python3
"""
okf-cli.py - Minimal Open Knowledge Format navigator + searcher
Python standard library only. For the karpathy-agent-orchestration bundle.

Usage:
  python okf-cli.py index [subpath]   # print table of contents
  python okf-cli.py find "<query>"    # ranked keyword search across the bundle
  python okf-cli.py read <path>       # print a single concept/video page
  python okf-cli.py meta              # bundle metadata (stats, tags)
"""
from __future__ import annotations
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STOPWORDS = {"the","a","an","of","to","in","on","and","or","is","are","be",
             "for","with","that","this","by","from","as","at","it","but",
             "how","what","why","when","is","you","your","they","their",
             "we","our","i","me","my","do","does","can","may","will"}

def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            return text[end+4:].lstrip("\n")
    return text

def parse_metadata(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    md = {}
    for line in text[3:end].splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([\w\-]+):\s*(.*?)(?:\s+#.*)?$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                items = [x.strip().strip("'\"") for x in val[1:-1].split(",") if x.strip()]
                md[key] = items
            elif val.startswith('"') and val.endswith('"'):
                md[key] = val[1:-1]
            else:
                md[key] = val
    return md

def all_pages(root: Path = ROOT):
    for p in sorted(root.rglob("*.md")):
        if p.name in {"log.md", "README.md"}:
            continue
        yield p

def render_index(subpath: str = ""):
    base = ROOT / subpath if subpath else ROOT
    shown = 0
    for p in sorted(base.rglob("*.md")):
        if p.name in {"log.md", "README.md"} or p.name == "index.md" and p.parent == ROOT:
            continue
        rel = p.relative_to(ROOT).as_posix()
        text = p.read_text(encoding="utf-8")
        meta = parse_metadata(text)
        title = meta.get("title") or p.stem.replace("-", " ").title()
        tags = ", ".join(meta.get("tags", []))
        print(f"  * [{rel}]({rel}) - {title}" + (f" _[{tags}]_" if tags else ""))
        shown += 1
    if shown == 0:
        print(f"  (no pages under '{subpath or '/'}')")

def render_meta():
    tags_count: dict[str, int] = {}
    n = 0
    for p in all_pages():
        text = p.read_text(encoding="utf-8")
        meta = parse_metadata(text)
        for t in meta.get("tags", []):
            tags_count[t] = tags_count.get(t, 0) + 1
        n += 1
    print("Bundle: karpathy-agent-orchestration")
    print(f"Pages: {n}")
    print("Top tags:")
    for t, c in sorted(tags_count.items(), key=lambda kv: -kv[1])[:10]:
        print(f"  {t} ({c})")

def tokenize(text: str) -> list[str]:
    text = text.lower()
    tokens = re.findall(r"[a-z0-9]+", text)
    return [t for t in tokens if t not in STOPWORDS and len(t) > 2]

def score_page(query_tokens: list[str], page_text: str, page_meta: dict) -> float:
    title_tokens = tokenize(page_meta.get("title", ""))
    desc_tokens = tokenize(page_meta.get("description", ""))
    body_tokens = set(tokenize(page_text))
    score = 0.0
    for qt in query_tokens:
        if qt in title_tokens:
            score += 5.0
        if qt in desc_tokens:
            score += 3.0
        if qt in body_tokens:
            score += 1.0
    return score

def cmd_find(query: str):
    q_tokens = tokenize(query)
    if not q_tokens:
        print(f"query '{query}' has no searchable tokens after stopword removal")
        return
    hits = []
    for p in all_pages():
        text = p.read_text(encoding="utf-8")
        meta = parse_metadata(text)
        body = strip_frontmatter(text)
        s = score_page(q_tokens, body, meta)
        if s > 0:
            hits.append((s, p, meta))
    hits.sort(key=lambda x: -x[0])
    print(f"Query: {query}")
    for rank, (s, p, meta) in enumerate(hits[:10], 1):
        rel = p.relative_to(ROOT).as_posix()
        title = meta.get("title", p.stem)
        print(f"  {rel} - {title}  (score={s:.2f})")
    if not hits:
        print("  no matches")

def cmd_read(path_str: str):
    p = (ROOT / path_str).resolve()
    in_bundle = (p == ROOT) or (ROOT in p.parents)
    if not p.exists() or not in_bundle:
        # try adding .md extension
        if not str(path_str).endswith(".md"):
            p2 = (ROOT / f"{path_str}.md").resolve()
            if p2.exists() and (p2 == ROOT or ROOT in p2.parents):
                p = p2
                in_bundle = True
    if not in_bundle:
        print(f"path '{path_str}' is outside the bundle")
        sys.exit(2)
    if p.is_dir():
        render_index(p.relative_to(ROOT).as_posix())
        return
    text = p.read_text(encoding="utf-8")
    body = strip_frontmatter(text)
    print(body)

def main():
    args = sys.argv[1:]
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__)
        return
    cmd, *rest = args
    if cmd == "index":
        sub = rest[0] if rest else ""
        render_index(sub)
    elif cmd == "find":
        if not rest:
            print("find requires a query string")
            sys.exit(2)
        cmd_find(" ".join(rest))
    elif cmd == "read":
        if not rest:
            print("read requires a path")
            sys.exit(2)
        cmd_read(rest[0])
    elif cmd == "meta":
        render_meta()
    else:
        print(f"unknown command: {cmd}")

if __name__ == "__main__":
    main()
