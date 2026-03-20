# Tuliptech Infrastructure

## Microsoft 365
| Item | Value |
|------|-------|
| **Tenant** | Tuliptech |
| **Admin** | Luca (llicata@tulip-tech.com) |
| **Middleware API** | http://localhost:3007/api |
| **Token storage** | `~/microsoft-middleware/data/tokens.db` (SQLite) |

**Configured agents:**
- `luca` - llicata@tulip-tech.com
- `max` - max@tulip-tech.com
- `sophia` - sophia@tulip-tech.com

## Teams Channels
| Channel | ID | Purpose |
|---------|-----|---------|
| Tuliptech Leadership | `19:115ed03fca964c769ce48a5bcfd49ab6@thread.v2` | Leadership discussions |
| AI Team | `19:a26774df269e4bea8d529104dfa61abd@thread.v2` | AI/R&D team |
| Empathika Team | `19:df5f3e2a7e3444d69f6f95c984937321@thread.v2` | Empathika product |
| Stretchsense Quote | `19:8f28ac05ecd340f9844044bbaeb7fcd4@thread.v2` | Stretchsense sales |

## Email
| Account | Purpose | Access |
|---------|---------|--------|
| llicata@tulip-tech.com | Luca's work email | `agent=luca` |
| max@tulip-tech.com | Max's email (automated sends) | `agent=max` |
| sophia@tulip-tech.com | Sophia's accounting | `agent=sophia` |

## Databases

### tuliptech.db
**Location:** `~/clawd/databases/tuliptech.db`

| Table | Records | Purpose |
|-------|---------|---------|
| personnel_salary | 80 | Employee names, roles, locations, salaries |
| departments | 7 | Department structure |
| customers | 17 | Client database |
| budget_items | 310 | Budget line items |
| sales_forecast | 152 | Sales projections |

### Key Queries
```bash
# Employee summary
node ~/clawd/scripts/query-finance.js tuliptech "SELECT location, COUNT(*) as count, SUM(total) as payroll FROM personnel_salary WHERE status='Active' GROUP BY location"

# All employees
node ~/clawd/scripts/query-finance.js tuliptech "SELECT name, role, location FROM personnel_salary"
```

### Stats (as of 2026-02-12)
- **Active Headcount:** 80
- **Annual Payroll:** £583,150
- **Largest office:** Bangladesh (66 employees)

## Related Services
- CareApps/Empathika (50% owned by Tuliptech)
- See [Empathika project](../empathika/README.md)

---

**Last Updated:** 2026-03-20 (Migrated to middleware API)
