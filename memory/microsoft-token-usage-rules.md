# Microsoft Token Usage Rules

## ⚠️ DEPRECATED - DO NOT USE

**This file is obsolete as of 20 March 2026.**

All Microsoft 365 operations now go through the **Microsoft Middleware API (port 3007)**.

## New Rules (Middleware-Based)

### Agent Selection (CRITICAL)

**When Luca asks about HIS calendar/email:**
```bash
curl "http://localhost:3007/api/email/list/luca?top=10"
curl "http://localhost:3007/api/calendar/list/luca?days=7"
```

**When operating as Max (sending emails as Max):**
```bash
curl -X POST "http://localhost:3007/api/email/send" \
  -H "Content-Type: application/json" \
  -d '{"agent":"max","to":"...","subject":"...","body":"..."}'
```

**When accessing Sophia's mailbox:**
```bash
curl "http://localhost:3007/api/email/list/sophia?top=10"
```

### Key Principle

**DEFAULT = `luca`** for all Luca-related requests ("check my emails", "check my calendar", etc.)

Only use `agent=max` when:
- Sending emails AS Max
- Accessing Max's personal mailbox

Only use `agent=sophia` when:
- Accessing Sophia's accounting mailbox

## Documentation

See: `memory/projects/microsoft-integration/README.md`
