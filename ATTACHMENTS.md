# Teams Attachments Guide

How to send and receive files in Microsoft Teams via the middleware.

---

## Receiving Attachments

When a Teams message contains attachments, the webhook handler automatically parses them and includes details in the wake text:

```
💬 Teams message from Luca Licata: "Check this document"

📎 Attachments:
- Project_Report.pdf (application/pdf)
  URL: https://graph.microsoft.com/v1.0/...
- Screenshot.png (image/png)
  URL: https://graph.microsoft.com/v1.0/...
```

### Attachment Object Structure

```json
{
  "name": "document.pdf",
  "contentType": "application/pdf",
  "contentUrl": "https://graph.microsoft.com/v1.0/..."
}
```

### Downloading Attachments

The `contentUrl` requires authentication:

```javascript
const token = await getAccessToken('max');
const response = await fetch(contentUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const buffer = await response.arrayBuffer();
```

---

## Sending Attachments

### Method 1: Send with Existing URL

If you have a file already accessible via URL (OneDrive, SharePoint, etc.):

```bash
POST /api/teams/send
Content-Type: application/json

{
  "agent": "max",
  "chatId": "19:...",
  "message": "<p>Here's the file you requested</p>",
  "attachments": [
    {
      "contentUrl": "https://contoso.sharepoint.com/file.pdf",
      "name": "file.pdf",
      "contentType": "application/pdf"
    }
  ]
}
```

### Method 2: Upload File First

For files you need to upload:

**Step 1: Upload to OneDrive**

```bash
POST /api/teams/upload
Content-Type: application/json

{
  "agent": "max",
  "fileName": "report.pdf",
  "fileContent": "<base64 encoded content>",
  "contentType": "application/pdf"
}
```

Response:
```json
{
  "success": true,
  "fileId": "01234567...",
  "fileName": "report.pdf",
  "webUrl": "https://contoso-my.sharepoint.com/.../report.pdf",
  "shareUrl": "https://contoso.sharepoint.com/:b:/g/..."
}
```

**Step 2: Send with SharePoint URL**

```bash
POST /api/teams/send
Content-Type: application/json

{
  "agent": "max",
  "chatId": "19:...",
  "message": "<p>Report attached</p>",
  "attachments": [
    {
      "contentUrl": "https://contoso.sharepoint.com/:b:/g/...",
      "name": "report.pdf",
      "contentType": "application/pdf"
    }
  ]
}
```

---

## Example: Node.js Upload & Send

```javascript
const fs = require('fs');

// Read file
const fileBuffer = fs.readFileSync('./report.pdf');
const base64Content = fileBuffer.toString('base64');

// Upload to OneDrive
const uploadResp = await fetch('http://localhost:3007/api/teams/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent: 'max',
    fileName: 'report.pdf',
    fileContent: base64Content,
    contentType: 'application/pdf'
  })
});

const upload = await uploadResp.json();

// Send to Teams chat
await fetch('http://localhost:3007/api/teams/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent: 'max',
    chatId: '19:15f6df21-...',
    message: '<p>Here is the report</p>',
    attachments: [{
      contentUrl: upload.shareUrl,
      name: 'report.pdf',
      contentType: 'application/pdf'
    }]
  })
});
```

---

## Supported File Types

Teams supports most common file types:

- **Documents:** PDF, DOCX, XLSX, PPTX, TXT
- **Images:** PNG, JPG, GIF, SVG
- **Archives:** ZIP, RAR
- **Code:** JS, PY, JSON, MD
- **Other:** CSV, XML, HTML

---

## File Size Limits

- **OneDrive upload:** Up to 250 MB per file
- **Teams message:** No explicit limit, but keep practical
- **Graph API:** Rate limits apply (see Microsoft docs)

---

## Storage Location

Files uploaded via `/api/teams/upload` are stored in:
```
OneDrive > TeamsAttachments/
```

This folder is created automatically if it doesn't exist.

---

## Security Notes

- Sharing links are **organization-only** by default
- Files inherit OneDrive permissions
- Attachment URLs require authentication
- Never expose tokens in attachment URLs

---

## Troubleshooting

### "Failed to upload file"

- Check file size (< 250 MB)
- Verify token has `Files.ReadWrite` permission
- Ensure base64 encoding is correct

### "Attachment not showing in Teams"

- Verify `contentUrl` is accessible
- Check `contentType` matches actual file
- Ensure URL is a valid sharing link

### "Download requires authentication"

- Attachment contentUrls from Graph API require bearer token
- Use sharing links (from `/api/teams/upload`) for direct access

---

## Complete Workflow Example

```javascript
// Receive attachment in webhook
// Wake text includes:
// 📎 Attachments:
// - document.pdf (application/pdf)
//   URL: https://graph.microsoft.com/v1.0/...

// Download the file
const token = await getAccessToken('max');
const fileResp = await fetch(contentUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const fileBuffer = await fileResp.arrayBuffer();

// Process file (e.g., analyze, transform)
const processed = processFile(fileBuffer);

// Upload processed file
const uploadResp = await fetch('http://localhost:3007/api/teams/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent: 'max',
    fileName: 'processed_document.pdf',
    fileContent: Buffer.from(processed).toString('base64'),
    contentType: 'application/pdf'
  })
});

const upload = await uploadResp.json();

// Send back to user
await fetch('http://localhost:3007/api/teams/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent: 'max',
    chatId: originalChatId,
    message: '<p>Here is the processed version</p>',
    attachments: [{
      contentUrl: upload.shareUrl,
      name: 'processed_document.pdf',
      contentType: 'application/pdf'
    }]
  })
});
```

---

## API Reference

### POST /api/teams/upload

Upload a file to OneDrive and get sharing link.

**Request:**
```json
{
  "agent": "max",
  "fileName": "document.pdf",
  "fileContent": "<base64>",
  "contentType": "application/pdf"
}
```

**Response:**
```json
{
  "success": true,
  "fileId": "01234567...",
  "fileName": "document.pdf",
  "webUrl": "https://...",
  "shareUrl": "https://..."
}
```

### POST /api/teams/send (with attachments)

Send message with file attachments.

**Request:**
```json
{
  "agent": "max",
  "chatId": "19:...",
  "message": "<p>Message text</p>",
  "attachments": [
    {
      "contentUrl": "https://...",
      "name": "file.pdf",
      "contentType": "application/pdf"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "1234567890"
}
```

---

**Need Help?** Check the main README or server logs for debugging.
