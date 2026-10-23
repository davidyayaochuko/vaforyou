# Knowledge base

Tracked files are `*.example.md` only. Your real FAQ, policies, and company facts stay on this machine.

```bash
# Or let npm run setup copy them when missing:
cp knowledge/faq.example.md knowledge/faq.md
cp knowledge/policies.example.md knowledge/policies.md
cp knowledge/usage-company.example.md knowledge/usage-company.md
```

Edit the copies. Funke loads every `knowledge/*.md` that is not an `.example.` file.

Keep domains separate on purpose:
- `albion-online.md` — official Albion site guides only (no Wikipedia).
- `speech-world.md` — how Funke speaks, thinks, and acts (Wikipedia).
- `nigeria-culture.md` — Nigerian culture, food, arts, everyday world (Wikipedia).
