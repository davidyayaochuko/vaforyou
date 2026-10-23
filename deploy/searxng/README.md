# SearXNG (Funke research)

Private web search for Chat “Research …” asks. Funke calls the JSON API on
loopback; it never scrapes public SearXNG instances.

```bash
docker compose -f deploy/searxng/compose.yml up -d
```

Then in `.env`:

```bash
SEARXNG_URL=http://127.0.0.1:8080
```

Smoke:

```bash
curl -sG 'http://127.0.0.1:8080/search' --data-urlencode 'q=searxng' --data-urlencode 'format=json' | head -c 200
```

If SearXNG is down or unset, research stays fail-closed (memory/KB only, no invented sources).
