#!/usr/bin/env python3
"""
golradar2 Tarihsel Veri Backfill
=================================
Gerçek maç verilerini toplar ve GBDT training-data.json'a dönüştürür.

Kaynaklar:
  Faz 1 — OpenLigaDB: Bundesliga, PL, Serie A, La Liga (2002-2026)
  Faz 2 — Nesine: 90+ lig, gerçek possession/xG/corners/shots (son N gün)
  Faz 3 — Sofascore: Detaylı maç istatistikleri, shot map, momentum (son N gün)
  Faz 4 — Convert: Tüm kaynakları TrainingRecord[] formatına birleştir

Kullanım:
  python3 scripts/backfill-training-data.py --action full
  python3 scripts/backfill-training-data.py --action openligadb --leagues bl1,bl2,PL,SA,PD
  python3 scripts/backfill-training-data.py --action nesine --days 30
  python3 scripts/backfill-training-data.py --action convert
"""

import json, sys, os, time, re, ssl, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "ml-training")
os.makedirs(DATA_DIR, exist_ok=True)

def log(msg):
    print(f"[Backfill] {msg}", flush=True)

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read().decode("utf-8")

def fetch_json(url: str) -> Any:
    return json.loads(fetch(url))

def write_jsonl(path: str, records: list):
    with open(path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

# ══════════════════════════════════════════════════════════════════
# FAZ 1: OpenLigaDB
# ══════════════════════════════════════════════════════════════════

OPENLIGA_LEAGUES = {"bl1": "Bundesliga 1", "bl2": "Bundesliga 2", "PL": "Premier League", "SA": "Serie A", "PD": "La Liga"}

def openligadb_backfill(leagues: str | None = None):
    shortcuts = [s.strip() for s in (leagues or "bl1,bl2,PL,SA,PD").split(",")]
    all_entries = fetch_json("https://api.openligadb.de/getavailableleagues")
    matches_out = []

    for sc in shortcuts:
        sc_up = sc.upper()
        seasons = set()
        for e in all_entries:
            if e.get("leagueShortcut", "").upper() == sc_up:
                seasons.add((e["leagueSeason"], e["leagueId"], e["leagueName"]))
        if not seasons:
            log(f"  ⚠ {sc} bulunamadı"); continue
        for season, lid, lname in sorted(seasons):
            log(f"  {lname} ({sc})...")
            try:
                data = fetch_json(f"https://api.openligadb.de/getmatchdata/{lid}/{season}")
            except:
                time.sleep(0.3); continue
            for m in (data or []):
                if not m.get("matchIsFinished"): continue
                ft = next((r for r in m.get("matchResults",[]) if r.get("resultName")=="Endergebnis"), None)
                goals = []
                for g in m.get("goals", []):
                    goals.append({"minute": g.get("matchMinute",0), "scorer": g.get("goalGetterName","")})
                matches_out.append({
                    "source":"openligadb", "match_id":m.get("matchID"), "league":lname,
                    "season":season, "date":m.get("matchDateTime",""),
                    "home_team":m.get("team1",{}).get("teamName",""),
                    "away_team":m.get("team2",{}).get("teamName",""),
                    "home_goals":(ft or {}).get("pointsTeam1",0),
                    "away_goals":(ft or {}).get("pointsTeam2",0),
                    "goals":goals,
                })
            time.sleep(0.3)
    path = os.path.join(DATA_DIR, "openligadb-matches.jsonl")
    write_jsonl(path, matches_out)
    log(f"  ✓ {len(matches_out)} maç → {path}")

# ══════════════════════════════════════════════════════════════════
# FAZ 2: Nesine (gerçek istatistikler)
# ══════════════════════════════════════════════════════════════════

NESINE_ET = {1:"corners",7:"shots_on_target",8:"dangerous_attacks",11:"possession",14:"yellow_cards",
             119:"shots_total",120:"shots_blocked",121:"xg"}

def nesine_backfill(days: int = 90):
    today = datetime.now(timezone.utc); matches_out = []
    for d in range(days, 0, -1):
        date = (today - timedelta(days=d)).strftime("%Y-%m-%d")
        try:
            url = f"https://ls.nesine.com/api/v2/LiveScore/GetUnliveMatches?sportType=1&date={date}"
            req = urllib.request.Request(url, headers={**HEADERS, "Referer":"https://www.nesine.com/"})
            with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                raw = json.loads(r.read())
            items = raw.get("d",[]) if isinstance(raw,dict) else raw
            for m in items:
                if not isinstance(m,dict) or m.get("S")!=5: continue
                bid = m.get("BID") or m.get("C"); ht=m.get("HT",""); at=m.get("AT","")
                if not bid or not ht or not at: continue
                es = (m.get("ES") or [{}])[0]
                se = m.get("SE") or []
                stats = {}
                for s in se:
                    et = s.get("ET")
                    if et in NESINE_ET:
                        stats[NESINE_ET[et]] = {"home":s.get("H",0),"away":s.get("A",0)}
                matches_out.append({
                    "bid":bid,"home_team":ht,"away_team":at,
                    "home_goals":(es.get("H") if isinstance(es,dict) else 0) or 0,
                    "away_goals":(es.get("A") if isinstance(es,dict) else 0) or 0,
                    "league":m.get("L",""),"date":date,"stats":stats,
                })
        except: pass
    path = os.path.join(DATA_DIR, "nesine-matches.jsonl")
    write_jsonl(path, matches_out)
    log(f"  ✓ {len(matches_out)} maç ({days} gün) → {path}")

# ══════════════════════════════════════════════════════════════════
# FAZ 3: Sofascore (detaylı)
# ══════════════════════════════════════════════════════════════════

def sofascore_backfill(days: int = 7):
    import subprocess
    script = os.path.join(os.path.dirname(__file__), "sofascore-bridge.py")
    today = datetime.now(timezone.utc); matches_out = []
    for d in range(days, 0, -1):
        date = (today - timedelta(days=d)).strftime("%Y-%m-%d")
        try:
            r = subprocess.run([sys.executable,script,"--action","matches-by-date","--date",date],
                               capture_output=True,text=True,timeout=30)
            day_matches = json.loads(r.stdout).get("data",[]) if json.loads(r.stdout).get("ok") else []
        except: day_matches = []
        for m in day_matches[:5]:  # rate-limit koruması
            gid = m.get("game_id")
            if not gid: continue
            try:
                r = subprocess.run([sys.executable,script,"--action","match-detail","--game-id",str(gid)],
                                   capture_output=True,text=True,timeout=30)
                detail = json.loads(r.stdout).get("data",{})
            except: continue
            info = detail.get("match_info",{})
            if info.get("status_type")!="finished": continue
            stats_list = detail.get("statistics",[])
            stats = {}
            for s in stats_list:
                if s.get("period")=="ALL":
                    k = s.get("stat_name","").lower().replace(" ","_")
                    stats[f"{k}_home"]=s.get("home"); stats[f"{k}_away"]=s.get("away")
            matches_out.append({
                "game_id":gid,"date":date,
                "home_team":info.get("home_team",""),"away_team":info.get("away_team",""),
                "home_goals":info.get("home_score_ft") or info.get("home_score",0),
                "away_goals":info.get("away_score_ft") or info.get("away_score",0),
                "stats":stats, "incidents":detail.get("incidents",[]),
                "shots":detail.get("shots",[]),
            })
            time.sleep(1.5)
    path = os.path.join(DATA_DIR, "sofascore-matches.jsonl")
    write_jsonl(path, matches_out)
    log(f"  ✓ {len(matches_out)} maç → {path}")

# ══════════════════════════════════════════════════════════════════
# FAZ 4: Convert → TrainingRecord[]
# ══════════════════════════════════════════════════════════════════

def to_num(v):
    try: return float(v)
    except: return 0.0

def build_features(m: dict) -> list[float]:
    f = [0.5]*67
    def norm(v,lo,hi): return max(0,min(1,(v-lo)/(hi-lo)))
    stats = {}
    if isinstance(m.get("stats"), dict):
        stats = m["stats"]
    if "possession" in stats:
        p=stats["possession"]; f[4]=to_num(p.get("home",50))/100; f[5]=abs(to_num(p.get("home",50))-to_num(p.get("away",50)))/100
    if "shots_total" in stats:
        s=stats["shots_total"]; f[7]=norm(to_num(s.get("home",0)),0,25); f[8]=norm(to_num(s.get("away",0)),0,25)
    if "shots_on_target" in stats:
        s=stats["shots_on_target"]; f[9]=norm(to_num(s.get("home",0)),0,12); f[10]=norm(to_num(s.get("away",0)),0,12)
        th = to_num(stats.get("shots_total",{}).get("home",0))
        ta = to_num(stats.get("shots_total",{}).get("away",0))
        if th>0: f[11]=to_num(s.get("home",0))/th
        if ta>0: f[12]=to_num(s.get("away",0))/ta
    if "corners" in stats:
        c=stats["corners"]; f[15]=norm(to_num(c.get("home",0)),0,15); f[16]=norm(to_num(c.get("away",0)),0,15)
    if "xg" in stats:
        x=stats["xg"]; f[13]=norm(to_num(x.get("home",0)),0,3); f[14]=norm(to_num(x.get("away",0)),0,3)
    if "yellow_cards" in stats:
        y=stats["yellow_cards"]; f[39]=(to_num(y.get("home",0))>2)*1.0; f[40]=(to_num(y.get("away",0))>2)*1.0
    # Skor context
    hg = m.get("home_goals",0) or 0; ag = m.get("away_goals",0) or 0
    f[25]=1.0; f[27]=0; f[28]=1; f[34]=0.53; f[26]=norm(1.3,0.5,1.5)
    f[35]=abs(hg-ag)/5; f[36]=(hg+ag)/6; f[37]=1.0 if hg==ag else 0; f[38]=1.0 if hg>ag else 0
    return f

def convert_to_training(horizon_min: int = 10, output: str = ""):
    if not output:
        output = os.path.join(os.path.dirname(__file__),"..","data","ml-models","training-data.json")
    records = []
    # OpenLigaDB
    p = os.path.join(DATA_DIR,"openligadb-matches.jsonl")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                m = json.loads(line)
                goal_mins = {g["minute"] for g in m.get("goals",[]) if g.get("minute")}
                for snap in [15,30,45,60,75,90]:
                    label = 1.0 if any(snap < gm <= snap+horizon_min for gm in goal_mins) else 0
                    records.append({"features":build_features(m),"label":label,
                                    "matchCode":-(m.get("match_id",0)),"minute":snap,
                                    "timestamp":int(datetime.now().timestamp()*1000),"side":"both"})
        log(f"  OpenLigaDB: {len([r for r in records if r['matchCode']<0])} kayıt")
    # Nesine
    p = os.path.join(DATA_DIR,"nesine-matches.jsonl")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                m = json.loads(line)
                for snap in [15,30,45,60,75,90]:
                    label = 1.0 if (m.get("home_goals",0)+(m.get("away_goals",0))) > 0 and snap < 80 else 0
                    records.append({"features":build_features(m),"label":label,
                                    "matchCode":m.get("bid",0),"minute":snap,
                                    "timestamp":int(datetime.now().timestamp()*1000),"side":"both"})
        log(f"  Nesine: {len([r for r in records if r['matchCode']>0])} kayıt")
    # Sofascore
    p = os.path.join(DATA_DIR,"sofascore-matches.jsonl")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                m = json.loads(line)
                shots_after = sum(1 for s in m.get("shots",[]) if s.get("is_goal"))
                for snap in [15,30,45,60,75,90]:
                    label = 1.0 if any((s.get("minute") or 0) > snap for s in m.get("shots",[]) if s.get("is_goal")) else 0
                    records.append({"features":build_features(m),"label":label,
                                    "matchCode":-(m.get("game_id",0)),"minute":snap,
                                    "timestamp":int(datetime.now().timestamp()*1000),"side":"both"})
        log(f"  Sofascore: {len([r for r in records if r['matchCode']<0])} kayıt")
    # Merge with existing
    existing = []
    if os.path.exists(output):
        try: existing = json.loads(open(output).read())
        except: pass
    exist_keys = {f"{r['matchCode']}-{r['minute']}" for r in existing}
    new = [r for r in records if f"{r['matchCode']}-{r['minute']}" not in exist_keys]
    merged = (existing + new)[-50000:]
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output,"w") as f: json.dump(merged, f, indent=2)
    goals = sum(1 for r in merged if r["label"]==1)
    log(f"  ✓ Toplam: {len(merged)} kayıt (yeni: {len(new)}) → {output}")
    log(f"  Sınıf: {goals} gol / {len(merged)-goals} yok (%{goals/max(1,len(merged))*100:.1f})")

# ══════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description="GolRadar tarihsel veri backfill")
    parser.add_argument("--action", required=True, choices=["openligadb","nesine","sofascore","convert","all"])
    parser.add_argument("--leagues", default="bl1,bl2,PL,SA,PD", help="OpenLigaDB lig kısayolları")
    parser.add_argument("--days", type=int, default=30, help="Geriye dönük gün")
    parser.add_argument("--horizon", type=int, default=10)
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if args.action in ("openligadb","all"):
        log("=== FAZ 1: OpenLigaDB ==="); openligadb_backfill(args.leagues)
    if args.action in ("nesine","all"):
        log("=== FAZ 2: Nesine ==="); nesine_backfill(args.days)
    if args.action in ("sofascore","all"):
        log("=== FAZ 3: Sofascore ==="); sofascore_backfill(args.days)
    if args.action in ("convert","all"):
        log("=== FAZ 4: Convert ==="); convert_to_training(args.horizon, args.output)
    log("=== TAMAMLANDI ===")

if __name__ == "__main__":
    main()
