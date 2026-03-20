# TOKEN_MANAGEMENT.md

## ⚠️ DEPRECATED - DO NOT USE

**This file is obsolete as of 20 March 2026.**

All Microsoft 365 token management is now handled by the **Microsoft Middleware** service.

## New Architecture

**Token Storage:** SQLite database at `~/microsoft-middleware/data/tokens.db`

**Token Refresh:** Automatic via middleware, no manual refresh needed

**Adding New Tokens:** 
```bash
ms-middleware token-device <agent>
```

**Documentation:**
- See: `memory/projects/microsoft-integration/README.md`
- See: `memory/projects/microsoft-integration/DEPLOYMENT.md`

## Migration Complete

All scripts have been updated to use the middleware API:
- ✅ `daily-briefing.js` → uses middleware
- ✅ `check-sentry-errors.js` → uses middleware
- ✅ `meeting-auto-join.js` → uses middleware

Legacy token files (`*-microsoft-tokens.json`) are no longer used.
