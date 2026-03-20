#!/usr/bin/env node
/**
 * Meeting Auto-Join Script
 * 
 * Checks Luca's calendar for meetings starting in the next 5 minutes
 * where Max (max@tulip-tech.com) is an invited attendee.
 * If found, starts the voice relay and joins the meeting.
 * 
 * UPDATED: Now uses Microsoft Middleware API (port 3007)
 * Token management handled by middleware, no direct token file access
 * 
 * Run via cron every 5 minutes.
 * No LLM needed — pure calendar logic.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIDDLEWARE_API = 'http://localhost:3007/api';
const MAX_EMAIL = 'max@tulip-tech.com';
const STATE_FILE = path.join(__dirname, '..', 'memory', 'meetings', 'auto-join-state.json');
const RELAY_DIR = path.join(__dirname, '..', 'recall-voice-agent');
const NODE_BIN = process.execPath; // Full path to node binary (works in cron)

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { joinedMeetings: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getCalendarEvents(startTime, endTime) {
  // Calculate days from now for middleware API
  const now = new Date();
  const days = Math.ceil((endTime - now) / (24 * 60 * 60 * 1000)) + 1;
  
  const resp = await fetch(`${MIDDLEWARE_API}/calendar/list/luca?days=${days}`);
  const allEvents = await resp.json();
  
  if (!Array.isArray(allEvents)) {
    throw new Error('Calendar fetch failed: ' + JSON.stringify(allEvents).substring(0, 200));
  }
  
  // Filter to events in the time window
  const events = allEvents.filter(e => {
    const eventStart = new Date(e.start.dateTime);
    return eventStart >= startTime && eventStart <= endTime;
  });
  
  return events;
}

function isMaxInvited(event) {
  if (!event.attendees) return false;
  return event.attendees.some(a => 
    a.emailAddress?.address?.toLowerCase() === MAX_EMAIL.toLowerCase()
  );
}

function getTeamsJoinUrl(event) {
  // Try onlineMeeting joinUrl first
  if (event.onlineMeeting?.joinUrl) return event.onlineMeeting.joinUrl;
  return null;
}

async function joinMeeting(meetingUrl, subject) {
  log(`Joining meeting: ${subject}`);
  log(`URL: ${meetingUrl}`);
  
  // Check if relay is already running
  try {
    const relayCheck = execSync('curl -s http://localhost:3002/ -o /dev/null -w "%{http_code}" 2>/dev/null', { encoding: 'utf8' });
    if (relayCheck.trim() !== '200') throw new Error('not running');
    log('Voice relay already running');
  } catch {
    log('Starting voice relay...');
    const relay = spawn(NODE_BIN, ['voice-relay-v2.cjs'], {
      cwd: RELAY_DIR,
      detached: true,
      stdio: 'ignore'
    });
    relay.unref();
    // Wait for relay to start
    await new Promise(r => setTimeout(r, 3000));
    log('Voice relay started');
  }

  // Join the meeting
  try {
    const result = execSync(
      `"${NODE_BIN}" join-voice-meeting-v2.js "${meetingUrl}"`,
      { cwd: RELAY_DIR, encoding: 'utf8', timeout: 30000 }
    );
    log('Join result: ' + result.trim());
    
    // Extract bot ID
    const botIdMatch = result.match(/Bot ID: ([a-f0-9-]+)/);
    return botIdMatch ? botIdMatch[1] : null;
  } catch (err) {
    log('Failed to join: ' + err.message);
    return null;
  }
}

async function notifyLuca(subject, botId) {
  // Wake Max's gateway to notify Luca
  try {
    const body = JSON.stringify({ text: `Auto-joined meeting: "${subject}" (Bot ID: ${botId}). Transcribing now.` });
    const req = require('http').request({
      hostname: 'localhost',
      port: 18789,
      path: '/hooks/wake',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer max-gateway-token-2026',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => log('Luca notified: ' + res.statusCode));
    });
    req.on('error', err => log('Notify error (non-fatal): ' + err.message));
    req.write(body);
    req.end();
  } catch (err) {
    log('Failed to notify: ' + err.message);
  }
}

async function main() {
  const state = loadState();
  const now = new Date();
  
  // Look for meetings starting in the next 7 minutes (gives buffer for cron timing)
  const windowStart = new Date(now.getTime() - 2 * 60000); // 2 min ago (catch ones just started)
  const windowEnd = new Date(now.getTime() + 7 * 60000);   // 7 min from now
  
  log(`Checking calendar: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

  // Get events in window via middleware
  const events = await getCalendarEvents(windowStart, windowEnd);
  
  log(`Found ${events.length} events in window`);

  for (const event of events) {
    // Skip cancelled events
    if (event.isCancelled) continue;
    
    // Skip if Max is not invited
    if (!isMaxInvited(event)) {
      log(`Skipping "${event.subject}" — Max not invited`);
      continue;
    }

    // Skip if no Teams URL
    const joinUrl = getTeamsJoinUrl(event);
    if (!joinUrl) {
      log(`Skipping "${event.subject}" — no Teams join URL`);
      continue;
    }

    // Skip if already joined today
    const eventKey = `${event.id}_${event.start.dateTime.substring(0, 10)}`;
    if (state.joinedMeetings[eventKey]) {
      log(`Skipping "${event.subject}" — already joined`);
      continue;
    }

    // Join!
    const botId = await joinMeeting(joinUrl, event.subject);
    if (botId) {
      state.joinedMeetings[eventKey] = {
        subject: event.subject,
        joinedAt: new Date().toISOString(),
        botId: botId
      };
      saveState(state);
      await notifyLuca(event.subject, botId);
    }
  }

  // Clean up old entries (older than 24h)
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  for (const [key, val] of Object.entries(state.joinedMeetings)) {
    if (new Date(val.joinedAt).getTime() < cutoff) {
      delete state.joinedMeetings[key];
    }
  }
  saveState(state);
  
  log('Done');
}

main().catch(err => {
  log('Error: ' + err.message);
  process.exit(1);
});
