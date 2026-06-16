"""Fetch JSON data from football.goaloo.com using curl_cffi."""

import json
import sys
from curl_cffi import requests


def main():
    url = sys.argv[1]
    s = requests.Session(impersonate="chrome131")
    r = s.get(url, timeout=30, headers={"Referer": "https://football.goaloo.com/"})
    data = json.loads(r.content.decode("utf-8-sig"))
    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
