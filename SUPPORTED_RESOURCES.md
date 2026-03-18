# Microsoft Graph Webhook Subscription - Supported Resources

Based on Microsoft Graph API v1.0 documentation.

## Currently Implemented

| Resource | Path | Change Type | Max Expiration | Notes |
|----------|------|-------------|----------------|-------|
| **Teams Chat Messages** | `/me/chats/getAllMessages` | `created` | 60 minutes | Get notifications for all Teams chat messages |
| **Outlook Email** | `/me/messages` | `created` | 3 days (4320 min) | Get notifications for new emails in mailbox |

---

## Additional Resources We Can Subscribe To

### Email & Calendar

| Resource | Path | Use Case | Max Expiration |
|----------|------|----------|----------------|
| **Inbox emails only** | `/me/mailFolders('inbox')/messages` | Monitor only inbox (not sent items, drafts, etc.) | 3 days |
| **Specific folder** | `/me/mailFolders('{folderId}')/messages` | Monitor a specific mail folder | 3 days |
| **Calendar events** | `/me/events` | Get notified of new/changed calendar events | 3 days |
| **Specific calendar** | `/me/calendars/{calendarId}/events` | Monitor a specific calendar | 3 days |
| **Contacts** | `/me/contacts` | Get notified of contact changes | 3 days |

### Teams

| Resource | Path | Use Case | Max Expiration |
|----------|------|----------|----------------|
| **Specific chat** | `/chats/{chatId}/messages` | Monitor messages in a specific chat | 60 minutes |
| **Specific channel** | `/teams/{teamId}/channels/{channelId}/messages` | Monitor messages in a specific channel | 60 minutes |
| **All channels in team** | `/teams/getAllMessages` | Monitor all Teams channel messages (org-wide) | 60 minutes |
| **Chat membership** | `/chats/{chatId}/members` | Get notified when people join/leave a chat | 60 minutes |
| **Team membership** | `/teams/{teamId}/members` | Get notified when people join/leave a team | 60 minutes |
| **Call records** | `/communications/callRecords` | Get notified of Teams call records | Varies |
| **Online meetings** | `/communications/onlineMeetings(joinWebUrl='{url}')/meetingCallEvents` | Get meeting call events | Varies |

### OneDrive / SharePoint

| Resource | Path | Use Case | Max Expiration |
|----------|------|----------|----------------|
| **User's OneDrive root** | `/me/drive/root` | Monitor changes to user's OneDrive | Varies |
| **Specific drive** | `/drives/{driveId}/root` | Monitor changes to a specific drive | Varies |
| **SharePoint list** | `/sites/{siteId}/lists/{listId}` | Monitor changes to a SharePoint list | Varies |

### User & Group Management

| Resource | Path | Use Case | Max Expiration |
|----------|------|----------|----------------|
| **All users** | `/users` | Get notified when users are created/updated/deleted | Varies |
| **Specific user** | `/users/{userId}` | Monitor changes to a specific user | Varies |
| **All groups** | `/groups` | Get notified when groups change | Varies |
| **Specific group** | `/groups/{groupId}` | Monitor changes to a specific group | Varies |
| **Group members** | `/groups/{groupId}/members` | Get notified when group membership changes | Varies |

### To-Do & Tasks

| Resource | Path | Use Case | Max Expiration |
|----------|------|----------|----------------|
| **To-Do tasks** | `/me/todo/lists/{listId}/tasks` | Get notified of changes to To-Do tasks | Varies |

---

## Recommended Additions for Max & Sophia

### Max (Primary Assistant)
```json
{
  "resource": "/me/calendarView",
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://microsoft.acuity.expert/webhook/calendar/max",
  "clientState": "max-calendar",
  "maxExpirationMinutes": 4320
}
```

### Sophia (Accountant)
```json
{
  "resource": "/me/calendarView",
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://microsoft.acuity.expert/webhook/calendar/sophia",
  "clientState": "sophia-calendar",
  "maxExpirationMinutes": 4320
}
```

---

## Change Types

| Change Type | Description |
|-------------|-------------|
| `created` | Resource was created |
| `updated` | Resource was modified |
| `deleted` | Resource was deleted |

You can combine multiple types: `"created,updated,deleted"`

---

## Important Notes

1. **Teams subscriptions expire quickly** (60 minutes max) - need frequent renewal
2. **Email/Calendar subscriptions** can last up to 3 days (4320 minutes)
3. **Max 1,000 active subscriptions per mailbox** across all apps
4. **Teams org-wide limit:** 10,000 total subscriptions for all Teams resources combined
5. Use `/me` instead of `/users/{userId}` when working with the authenticated user's resources

---

## References
- [Microsoft Graph Change Notifications Overview](https://learn.microsoft.com/en-us/graph/api/resources/change-notifications-api-overview?view=graph-rest-1.0)
- [Create Subscription API](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0)
