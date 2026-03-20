# Tuliptech Configuration

## Microsoft 365 Integration
| Item | Location |
|------|----------|
| **Middleware API** | http://localhost:3007/api |
| **Token storage** | `~/microsoft-middleware/data/tokens.db` (SQLite) |
| **Service** | `microsoft-middleware.service` (systemd user) |

**Agents configured:**
- `luca` - Luca's calendar and email (llicata@tulip-tech.com)
- `max` - Max's mailbox (max@tulip-tech.com)
- `sophia` - Sophia's accounting mailbox (sophia@tulip-tech.com)

## Email Accounts
| Account | Use |
|---------|-----|
| llicata@tulip-tech.com | Luca's work (access via `agent=luca`) |
| max@tulip-tech.com | Max's automated sends (access via `agent=max`) |
| sophia@tulip-tech.com | Sophia's accounting (access via `agent=sophia`) |

## Teams Webhook (Sophia)
- Sophia uses Teams webhooks for communication
- Config: `~/.openclaw-sophia/openclaw.json`

## Working Hours
| Office | Hours (Local) | Timezone |
|--------|---------------|----------|
| Leicester (UK) | 9 AM - 6 PM | GMT/BST |
| Dhaka (Bangladesh) | 12 PM - 8 PM | GMT+6 |

**Note:** Dhaka works Sunday-Thursday

## Ownership Structure
```
Luca (50%) → Tuliptech (50%) → CareApps → Empathika
```

---

**Last Updated:** 2026-03-20 (Migrated to middleware API)
