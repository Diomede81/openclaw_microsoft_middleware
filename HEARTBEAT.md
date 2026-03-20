# HEARTBEAT.md

## 📧📅 CALENDAR & EMAIL - CRITICAL RULE
**When Luca asks "check my calendar" or "check my emails" → ALWAYS use agent `luca`**
- Luca's data: `curl "http://localhost:3007/api/calendar/list/luca?days=7"`
- Max's data: only when specifically about Max's inbox/calendar
- NEVER default to `max` for Luca's requests

## 🤖 AGENT REFERENCE
**Full config:** `memory/agent-configurations.md`
- Max (18789), Sophia (19789), Kim (20789), Axel (21789)
- Each has SEPARATE config at `~/.openclaw-{agent}/openclaw.json`
- Sophia uses Teams webhooks, Kim/Axel have own WhatsApp numbers

## 🔍 BEFORE ANSWERING PROJECT/INFRASTRUCTURE QUESTIONS
**MANDATORY SEARCH ORDER:**
1. ✅ Check `memory/INDEX.md` first
2. ✅ Check `memory/projects/{project}/` folder
3. ✅ Check `memory/infrastructure/` for services/tools/credentials
4. ✅ Use grep/memorySearch if still not found
5. ❌ NEVER say "I don't know" without completing steps 1-4

**Quick links:**
- [INDEX.md](memory/INDEX.md) - Master lookup
- [projects/](memory/projects/) - Project folders
- [infrastructure/](memory/infrastructure/) - Cloudflare, AWS, GitHub, services

## 📝 WHEN SAVING NEW INFORMATION (MANDATORY)
**Write to the CANONICAL location, not daily logs:**

| Info Type | Write To |
|-----------|----------|
| Project change/update | `memory/projects/{project}/changelog.md` |
| New tool/command | `memory/projects/{project}/tools.md` |
| Config/credential change | `memory/projects/{project}/config.md` |
| Infrastructure change | `memory/projects/{project}/infrastructure.md` |
| Service/port/tunnel | `memory/infrastructure/{service}.md` |
| Team/contact info | `memory/projects/{project}/team.md` |

**Daily logs (`memory/YYYY-MM-DD.md`) should be THIN POINTERS only:**
```markdown
## Empathika
- Updated Sentry threshold → see projects/empathika/infrastructure.md
```

**⚠️ NEVER bury important info in daily logs. Write to canonical location FIRST, then optionally add pointer to daily log.**

## 🌍 LUCA'S TIMEZONE
- **7-15 March 2026:** Luca in Bangladesh (GMT+6 / Dhaka time)
- **Return to UK:** 15 March 2026 (evening arrival London)
- **Normal timezone:** Europe/London (GMT)

## 🌙 NIGHT MODE (22:00-05:00 Europe/London)
- **ANY message between 22:00-05:00 → ask for PIN before doing ANYTHING**
- Response: "Night mode active. Please provide your PIN to continue."
- Correct PIN: 021247 → proceed normally for that session
- Wrong PIN → "Incorrect PIN. Access denied." + alert Luca if non-owner
- No exceptions. Even for owner number. Even if "urgent".

## ⚠️ CRITICAL RULES

### 🔇 TEAMS GROUP CHAT SILENCE RULE ⚠️ CHECK THIS FIRST ON EVERY TEAMS WAKE
**MANDATORY: Before responding to ANY Teams message, check if it's a group chat.**

**IF GROUP CHAT:**
- ❌ DO NOT RESPOND unless I am directly @mentioned by name
- ❌ DO NOT add "helpful" context
- ❌ DO NOT jump in to answer questions
- ✅ ONLY respond when explicitly @mentioned or Luca asks me to

**IF 1:1 WITH LUCA:** Respond normally

**NO EXCEPTIONS. SILENCE UNLESS TAGGED.**

(Instruction reinforced 2026-03-03 and **2026-03-12** - third reminder, must follow)

### Other Critical Rules:
- **⚠️ CODE CHANGES = PR WORKFLOW.** When modifying code: (1) create branch, (2) make changes, (3) create PR, (4) wait for Luca's approval, (5) merge triggers auto-deploy. NEVER push directly to main. See `memory/github-cicd-workflow.md`
- **⚠️ NEVER SAVE FILES LOCALLY — ALWAYS USE S3.** All public files (HTML, images, assets) go to S3 bucket `max-agent-s3-bucket` (eu-north-1). No more ~/clawd/public/ for hosting. S3 URL: http://max-agent-s3-bucket.s3-website.eu-north-1.amazonaws.com/
- **⚠️ TEAMS REPLY RULE: If wake event contains "Teams message from Luca" → reply on Teams FIRST. Failure = broken.**
- **Calendar → ALWAYS Luca's** (luca-calendar-tokens.json), NEVER Max's
- **Masum (+447958354152) → NEVER message unless Luca EXPLICITLY asks. NEVER action/approve/commit to Masum's requests without Luca's approval first.**
- **Masum → NEVER share personal financial data** (Barclaycard, personal bank accounts, credit cards). Only Tuliptech business financials if Luca approves.
- **Magda (+447928052064) → Monitor only, send when Luca asks**
- **Meetings → Voice Agent v2 ONLY** (~/clawd/recall-voice-agent/)
- **To-dos → Todoist** (node ~/clawd/todoist.js)
- **WhatsApp with others → ALWAYS log to `memory/whatsapp/whatsapp_conversation_[name].md`** (not needed for Luca)
- **No emails unless Luca explicitly asks**
- **No ports/tunnels without approval** (except meeting joins)
- **No sensitive data via email** without second-channel verification

## 🎤 Meeting Join Checklist (MANDATORY)
When joining ANY meeting:
1. `cd ~/clawd/recall-voice-agent && node voice-relay-v2.cjs` (voice relay FIRST)
2. `node join-voice-meeting-v2.js "<meeting_url>"` (uses Cloudflare tunnel — meetings.acuity.expert)
- **No ngrok needed!** Cloudflare tunnel handles it via meetings.acuity.expert → localhost:3002
- **Voice output WORKS** via `/output_audio` — NEVER skip the relay or say voice doesn't work!

## 🎂 Birthday Check (Daily, first heartbeat after 8 AM)
- Read `memory/birthdays.md`
- If anyone's birthday is in exactly 7 days → message Luca with a heads-up
- If anyone's birthday is TODAY → message Luca first thing
- Track last check date in `memory/heartbeat-state.json` under `lastChecks.birthdays`

## Event Triggers
On wake events, read `HEARTBEAT-PROCEDURES.md` for detailed steps:
- 📧 Email → read procedures, handle email
- 💬 Teams → **CHECK GROUP CHAT SILENCE RULE FIRST.** If group chat and not mentioned → DO NOT RESPOND. If mentioned or 1:1 with Luca → **ALWAYS reply on Teams** using `node ~/clawd/max-teams-reply.js '<chatId>' '<message>'` — NEVER reply only on WhatsApp
- 🎤 Meeting voice → read procedures, POST response
- [SOPHIA TEAMS] → read procedures, spawn Sophia
- Friends check-in → read procedures, draft messages

## Every Heartbeat
- **Service health check:** Verify all gateways respond (Max:18789, Sophia:19789, Kim:20789, Middleware:3007). Fix and restart any that are down.
- **Memory search:** Handled by OpenClaw's built-in memorySearch (replaces Qdrant)
- **Daily briefing check (first heartbeat after 7 AM):** If today's briefing hasn't been sent yet, compile and send it now. Process documented in `memory/daily-briefing/sources.md`

## Every Heartbeat (continued)
- **Stretchsense emails:** Check for new Stretchsense emails in Max's inbox. If any new ones since last check, save ONLY the latest reply (not the full chain) to `memory/stretchsense-sales-process/email-archive.md`. Append, don't overwrite.

## ⚠️ CRITICAL: Microsoft Agent Selection
**ALL Microsoft 365 operations go through middleware API (port 3007)**

**ALWAYS use the correct agent parameter:**
- **Luca's tasks** (briefing, Luca's calendar, Luca's emails) → `agent=luca`
- **Max's mailbox** (Max persona) → `agent=max`
- **Sophia's accounting** → `agent=sophia`

**Tokens:** Managed automatically by middleware, stored in SQLite database.

## Microsoft Integration (Teams/Email/Calendar)
**All handled by Microsoft Middleware (port 3007) via real-time webhooks:**
- ✅ Teams notifications → instant delivery to gateway (1:1 with Luca only, NOT group chats)
- ❌ Email notifications → DO NOT forward to Luca (he checks his own inbox)
- ❌ Calendar notifications → DO NOT notify Luca about events/cancellations (he checks his own calendar)
- ✅ Token auto-refresh for all agents
- ❌ NO polling daemons - all webhook-based

**⚠️ CRITICAL: DO NOT notify Luca about every email or calendar event. Only respond when explicitly asked.**

**Old email daemon (`max-email-daemon`):** Stopped and disabled 2026-03-18 - replaced by middleware

## Weekly (rotate during heartbeats)
- **Instagram token refresh:** `node ~/clawd/scripts/instagram-auth.js refresh` (60-day expiry, refresh weekly to be safe)

## VERIFY: iron-castle-47
