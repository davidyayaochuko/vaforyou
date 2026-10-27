# Browser agency (Workstream H spike)

Funke can operate a **headed Playwright** browser for non-social tasks (forms, booking research, carts). This is separate from LinkedIn / X / Bluesky Chromium profiles under `PROFILES_DIR`.

## Policy (code)

| Action | Behaviour |
|---|---|
| Browse, read page, fill fields | Allowed when Playwright MCP is configured |
| Submit form / send | Approvals rail (`browser.submit`), not auto |
| Pay / checkout / card entry | **Hard blocked**, owner finishes pay |
| Social account profiles | **Never opened** by this lane |

## Enable (spike)

```bash
# .env
PLAYWRIGHT_MCP_COMMAND=npx
PLAYWRIGHT_MCP_ARGS=@playwright/mcp@latest
```

Chat examples:

- “Fill the demo contact form at https://…”
- “Stop at the cart on …”
- “Pay for this order” → refused

Live MCP tool loop (stdio client, same shape as Workspace) is the follow-up after this spike. Until then, Chat explains setup and blocks payment.

## Social engine untouched

`npm run login` profiles stay for the social scheduler only. Browser agency must use a fresh user-data-dir if persistence is added later.
