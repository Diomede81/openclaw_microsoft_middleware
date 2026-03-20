#!/usr/bin/env node
/**
 * Daily Sentry Error Check for Empathika
 * Scans Luca's inbox for Sentry weekly/alert emails, detects elevated errors, alerts Empathika Team
 * 
 * UPDATED: Now uses Microsoft Middleware API (port 3007)
 * Token management handled by middleware, no direct token file access
 */

const MIDDLEWARE_API = 'http://localhost:3007/api';
const EMPATHIKA_TEAM_CHAT = '19:df5f3e2a7e3444d69f6f95c984937321@thread.v2';

// Thresholds
const ERROR_THRESHOLD = 500;       // 500+ total errors = elevated
const ESCALATING_THRESHOLD = 3;    // 3+ escalating issues = flag

async function checkSentryEmails() {
  try {
    // Get emails from Luca's inbox via middleware
    const emailRes = await fetch(`${MIDDLEWARE_API}/email/list/luca?top=50`);
    const allEmails = await emailRes.json();
    
    if (!Array.isArray(allEmails) || allEmails.length === 0) {
      console.log('No emails retrieved');
      return;
    }
    
    // Filter for Sentry emails
    const sentryEmails = allEmails.filter(e => {
      const addr = e.from?.emailAddress?.address?.toLowerCase() || '';
      const name = e.from?.emailAddress?.name?.toLowerCase() || '';
      return addr.includes('getsentry.com') || addr.includes('sentry.io') || name === 'sentry';
    });
    
    if (sentryEmails.length === 0) {
      console.log('No Sentry emails found in recent inbox');
      return;
    }
    
    console.log(`Found ${sentryEmails.length} Sentry email(s)`);
    
    // Get full body of the most recent Sentry email
    const latest = sentryEmails[0];
    const fullEmailRes = await fetch(`${MIDDLEWARE_API}/email/read/luca/${latest.id}`);
    const fullEmail = await fullEmailRes.json();
    
    const bodyText = fullEmail.body?.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
    
    console.log(`Subject: ${latest.subject}`);
    console.log(`Date: ${latest.receivedDateTime}`);
    
    // Parse key metrics from the weekly report
    const totalErrorsMatch = bodyText.match(/Total Project Errors\s+([\d,.]+k?)/i);
    const totalTransMatch = bodyText.match(/Total Project Transactions\s+([\d,.]+k?)/i);
    const newIssuesMatch = bodyText.match(/New\s*\((\d+)\)/i);
    const escalatingMatch = bodyText.match(/Escalating\s*\((\d+)\)/i);
    const regressedMatch = bodyText.match(/Regressed\s*\((\d+)\)/i);
    const ongoingMatch = bodyText.match(/Ongoing\s*\((\d+)\)/i);
    
    // Parse project breakdown (format: "careapps-frontend-v2 1.2k 1 26.7k 0")
    const frontendMatch = bodyText.match(/careapps-frontend-v2\s+([\d,.]+k?)\s/i);
    const backendMatch = bodyText.match(/careapps-backend\s+([\d,.]+k?)\s/i);
    
    const parseNum = (s) => {
      if (!s) return 0;
      s = s.replace(/,/g, '');
      if (s.toLowerCase().endsWith('k')) return parseFloat(s) * 1000;
      return parseFloat(s);
    };
    
    const totalErrors = totalErrorsMatch ? parseNum(totalErrorsMatch[1]) : 0;
    const newIssues = newIssuesMatch ? parseInt(newIssuesMatch[1]) : 0;
    const escalating = escalatingMatch ? parseInt(escalatingMatch[1]) : 0;
    const regressed = regressedMatch ? parseInt(regressedMatch[1]) : 0;
    const ongoing = ongoingMatch ? parseInt(ongoingMatch[1]) : 0;
    const frontendErrors = frontendMatch ? parseNum(frontendMatch[1]) : 0;
    const backendErrors = backendMatch ? parseNum(backendMatch[1]) : 0;
    
    console.log(`\nParsed metrics:`);
    console.log(`  Total errors: ${totalErrors}`);
    console.log(`  Frontend: ${frontendErrors}, Backend: ${backendErrors}`);
    console.log(`  New: ${newIssues}, Escalating: ${escalating}, Regressed: ${regressed}, Ongoing: ${ongoing}`);
    
    // Determine if elevated
    const isElevated = totalErrors >= ERROR_THRESHOLD || escalating >= ESCALATING_THRESHOLD;
    
    if (!isElevated) {
      console.log(`\nNormal levels (threshold: ${ERROR_THRESHOLD} errors or ${ESCALATING_THRESHOLD} escalating)`);
      return;
    }
    
    console.log(`\n⚠️  ELEVATED - sending alert to Empathika Team`);
    
    // Extract top issues for the alert
    const topIssues = [];
    const issueRegex = /(\d+)\s+(.+?)\s+(careapps-\S+)\s+(Ongoing|Escalating|New|Regressed)/gi;
    let match;
    while ((match = issueRegex.exec(bodyText)) !== null && topIssues.length < 5) {
      topIssues.push({ count: match[1], title: match[2].trim().substring(0, 80), project: match[3], status: match[4] });
    }
    
    // Build Teams message
    const reportPeriod = latest.subject.replace('Weekly Report for TulipTech LTD: ', '');
    const message = `<b>⚠️ Sentry Weekly Report — Elevated Errors Detected</b><br><br>` +
      `<b>Period:</b> ${reportPeriod}<br><br>` +
      `<b>Summary:</b><br>` +
      `• Total errors: <b>${totalErrors.toLocaleString()}</b><br>` +
      `• Frontend (careapps-frontend-v2): <b>${frontendErrors.toLocaleString()}</b><br>` +
      `• Backend (careapps-backend): <b>${backendErrors.toLocaleString()}</b><br><br>` +
      `<b>Issue Breakdown:</b><br>` +
      `• New: ${newIssues} | Escalating: <b>${escalating}</b> | Regressed: ${regressed} | Ongoing: ${ongoing}<br><br>` +
      (topIssues.length > 0 ? `<b>Top Issues:</b><br>` + topIssues.map(i => `• [${i.status}] ${i.count}× ${i.title} (${i.project})`).join('<br>') + '<br><br>' : '') +
      `<b>Questions for the team:</b><br>` +
      `1. Are you aware of these error levels?<br>` +
      `2. How are you approaching the escalating issues?<br>` +
      `3. Do you need any support?`;
    
    // Send to Empathika Team chat via middleware
    const sendRes = await fetch(`${MIDDLEWARE_API}/teams/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'max',
        chatId: EMPATHIKA_TEAM_CHAT,
        message: message
      })
    });
    
    if (sendRes.ok) {
      console.log('✅ Alert sent to Empathika Team');
    } else {
      const err = await sendRes.text();
      console.error('❌ Failed to send alert:', err);
      // Fallback: use max-teams-reply.js
      const { execSync } = require('child_process');
      const NODE = process.execPath;
      execSync(`${NODE} /home/lucalicata/clawd/memory/projects/microsoft-integration/scripts/max-teams-reply.js '${EMPATHIKA_TEAM_CHAT}' '${message.replace(/'/g, "\\'")}'`, { stdio: 'inherit' });
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkSentryEmails();
