#!/usr/bin/env node
/**
 * Daily Briefing Script
 * Sources: Luca's inbox newsletters, The Verge AI news, Last Week in AI podcast, AI Daily Brief YouTube
 * 
 * UPDATED: Now uses Microsoft Middleware API (port 3007)
 * Token management handled by middleware, no direct token file access
 */

const fs = require('fs');
const { execSync } = require('child_process');

const MIDDLEWARE_API = 'http://localhost:3007/api';
const NEWSLETTER_SENDERS = ['rundown', 'beehiiv', 'therundown', 'agentai'];

async function getNewsletters() {
  console.log('📧 Scanning Luca\'s inbox for newsletters...');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  // Fetch emails via middleware
  const resp = await fetch(`${MIDDLEWARE_API}/email/list/luca?top=50`);
  const data = await resp.json();
  if (data.error) throw new Error(`Email fetch failed: ${data.error.message || data.error}`);
  
  const newsletters = data.filter(e => {
    const receivedDate = new Date(e.receivedDateTime);
    const isRecent = receivedDate >= new Date(yesterday);
    const addr = e.from.emailAddress.address.toLowerCase();
    return isRecent && NEWSLETTER_SENDERS.some(sender => addr.includes(sender));
  });
  
  console.log(`   Found ${newsletters.length} newsletters`);
  
  // Fetch full content for each newsletter
  for (let i = 0; i < newsletters.length; i++) {
    const fullResp = await fetch(`${MIDDLEWARE_API}/email/read/luca/${newsletters[i].id}`);
    const full = await fullResp.json();
    newsletters[i].fullBody = full.body;
  }
  
  return newsletters;
}

async function getAINews() {
  console.log('🤖 Fetching AI news from The Verge...');
  try {
    const html = execSync('curl -sL "https://www.theverge.com/ai-artificial-intelligence" --max-time 30 -A "Mozilla/5.0"', { encoding: 'utf8' });
    
    const articles = [];
    // Look for headline patterns
    const patterns = [
      /<h2[^>]*>([^<]{20,150})<\/h2>/gi,
      /<a[^>]*class="[^"]*group[^"]*"[^>]*>([^<]{20,150})<\/a>/gi
    ];
    
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(html)) !== null && articles.length < 8) {
        const title = match[1].trim().replace(/&amp;/g, '&').replace(/&#x27;/g, "'");
        if (!articles.some(a => a.title === title)) {
          articles.push({ title, url: 'https://www.theverge.com/ai-artificial-intelligence' });
        }
      }
    }
    
    console.log(`   Found ${articles.length} articles`);
    return articles;
  } catch (err) {
    console.log(`   ⚠️ AI news fetch failed: ${err.message}`);
    return [];
  }
}

async function getLastWeekInAI() {
  console.log('🎙️ Checking Last Week in AI podcast...');
  try {
    const html = execSync('curl -sL "https://podcasts.apple.com/us/podcast/last-week-in-ai/id1502782720" --max-time 30 -A "Mozilla/5.0"', { encoding: 'utf8' });
    
    const episodes = [];
    const episodeMatch = html.match(/Episode \d+[^<]*/gi);
    if (episodeMatch && episodeMatch.length > 0) {
      episodes.push({ title: episodeMatch[0], isRecent: true });
    }
    
    console.log(`   Found ${episodes.length} recent episodes`);
    return episodes;
  } catch (err) {
    console.log(`   ⚠️ Podcast fetch failed: ${err.message}`);
    return [];
  }
}

async function getAIDailyBrief() {
  console.log('📺 Checking AI Daily Brief YouTube...');
  try {
    const html = execSync('curl -sL "https://www.youtube.com/@AIDailyBrief/videos" --max-time 30 -A "Mozilla/5.0"', { encoding: 'utf8' });
    
    const videos = [];
    const titleRegex = /"title":\s*{\s*"runs":\s*\[\s*{\s*"text":\s*"([^"]+)"/g;
    let match;
    while ((match = titleRegex.exec(html)) !== null && videos.length < 3) {
      const title = match[1];
      if (title.length > 20 && !title.includes('AI Daily Brief')) {
        videos.push({ title });
      }
    }
    
    console.log(`   Found ${videos.length} recent videos`);
    return videos;
  } catch (err) {
    console.log(`   ⚠️ YouTube fetch failed: ${err.message}`);
    return [];
  }
}

async function buildAndSendBriefing(newsletters, aiNews, podcast, youtube) {
  console.log('📝 Building briefing email...');
  
  const date = new Date().toLocaleDateString('en-GB', { 
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
  });
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h2 { color: #007bff; margin-top: 30px; }
    h3 { color: #555; }
    .source { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .article { margin: 10px 0; padding: 10px; border-left: 3px solid #007bff; }
    a { color: #007bff; }
    hr { border: none; border-top: 1px solid #eee; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>🌅 Daily Briefing - ${date}</h1>`;

  // Section 1: Newsletters
  html += '<h2>📰 Newsletters</h2>';
  if (newsletters.length > 0) {
    for (const n of newsletters) {
      const time = new Date(n.receivedDateTime).toLocaleString('en-GB', {timeZone: 'Europe/London'});
      html += `<div class="source">`;
      html += `<h3>${n.subject}</h3>`;
      html += `<p><small>From: ${n.from.emailAddress.address} | ${time}</small></p>`;
      
      if (n.fullBody && n.fullBody.content) {
        let textContent = n.fullBody.content
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 2500);
        html += `<p>${textContent}...</p>`;
      } else {
        html += `<p>${n.bodyPreview}</p>`;
      }
      html += `</div>`;
    }
  } else {
    html += '<p>No newsletters received in the last 24 hours.</p>';
  }

  // Section 2: AI News
  html += '<h2>🤖 AI News (The Verge)</h2>';
  if (aiNews.length > 0) {
    html += '<div class="source">';
    for (const article of aiNews) {
      html += `<div class="article"><strong>${article.title}</strong> <a href="${article.url}">[Read more]</a></div>`;
    }
    html += '</div>';
  } else {
    html += '<p>Unable to fetch AI news today.</p>';
  }

  // Section 3: Podcast
  html += '<h2>🎙️ Last Week in AI Podcast</h2>';
  if (podcast.length > 0) {
    html += '<div class="source">';
    for (const ep of podcast) {
      html += `<div class="article"><strong>${ep.title}</strong></div>`;
    }
    html += '<p><a href="https://podcasts.apple.com/us/podcast/last-week-in-ai/id1502782720">Listen on Apple Podcasts</a></p></div>';
  } else {
    html += '<p>No new episodes in the last 3 days.</p>';
  }

  // Section 4: YouTube
  html += '<h2>📺 AI Daily Brief (YouTube)</h2>';
  if (youtube.length > 0) {
    html += '<div class="source">';
    for (const video of youtube) {
      html += `<div class="article"><strong>${video.title}</strong></div>`;
    }
    html += '<p><a href="https://www.youtube.com/@AIDailyBrief">Watch on YouTube</a></p></div>';
  } else {
    html += '<p>No new videos today.</p>';
  }

  html += `<hr><p style="color: #999; font-size: 12px;">Generated by Max at ${new Date().toLocaleString('en-GB', {timeZone: 'Europe/London'})}</p></body></html>`;

  // Send email via middleware
  console.log('📤 Sending email...');
  const subject = `Daily Briefing - ${new Date().toLocaleDateString('en-GB')}`;
  
  const sendResp = await fetch(`${MIDDLEWARE_API}/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent: 'max',
      to: 'llicata@tulip-tech.com',
      subject: subject,
      body: html
    })
  });
  
  const sendText = await sendResp.text();
  console.log('   Send response:', sendText);
  if (!sendText.includes('success')) throw new Error('Email send failed: ' + sendText);
  
  // Save to memory
  const dateStr = new Date().toISOString().split('T')[0];
  const mdContent = `# Daily Briefing - ${date}\n\n` +
    `## Newsletters (${newsletters.length})\n` + newsletters.map(n => `- ${n.subject}`).join('\n') + '\n\n' +
    `## AI News (${aiNews.length})\n` + aiNews.map(a => `- ${a.title}`).join('\n') + '\n\n' +
    `## Podcast (${podcast.length})\n` + podcast.map(e => `- ${e.title}`).join('\n') + '\n\n' +
    `## AI Daily Brief (${youtube.length})\n` + youtube.map(v => `- ${v.title}`).join('\n');
  
  fs.writeFileSync(`/home/lucalicata/clawd/memory/daily-briefing/${dateStr}.md`, mdContent);
  console.log('✅ Briefing sent and saved!');
}

async function main() {
  console.log('🌅 Starting Daily Briefing...\n');
  
  const newsletters = await getNewsletters();
  const aiNews = await getAINews();
  const podcast = await getLastWeekInAI();
  const youtube = await getAIDailyBrief();
  
  await buildAndSendBriefing(newsletters, aiNews, podcast, youtube);
  
  console.log('\n📊 Summary:');
  console.log(`   Newsletters: ${newsletters.length}`);
  console.log(`   AI News: ${aiNews.length}`);
  console.log(`   Podcast: ${podcast.length}`);
  console.log(`   YouTube: ${youtube.length}`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
