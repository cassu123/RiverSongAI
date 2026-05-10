from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["legal"])

_PRIVACY_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — River Song AI</title>
  <style>
    :root {
      --bg: #0f1316;
      --surface: #171c1f;
      --card: #1e2428;
      --border: #2e3538;
      --primary: #96cbff;
      --text: #dee4e9;
      --muted: #8a9ba8;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      padding: 0 16px 64px;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 20px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
    }
    header .logo {
      width: 36px; height: 36px;
      background: var(--primary);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: #003354;
    }
    header h1 { font-size: 1.1rem; color: var(--text); font-weight: 600; }
    header p { font-size: 0.8rem; color: var(--muted); }
    .wrapper { max-width: 760px; margin: 40px auto; }
    .hero {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 32px;
      margin-bottom: 32px;
      text-align: center;
    }
    .hero h2 { font-size: 1.6rem; color: var(--primary); margin-bottom: 8px; }
    .hero p { color: var(--muted); font-size: 0.95rem; }
    .hero .updated {
      display: inline-block;
      margin-top: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 14px;
      font-size: 0.8rem;
      color: var(--muted);
    }
    section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px 32px;
      margin-bottom: 20px;
    }
    section h3 {
      font-size: 1.05rem;
      color: var(--primary);
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    p { margin-bottom: 12px; color: var(--text); }
    p:last-child { margin-bottom: 0; }
    ul, ol { padding-left: 22px; margin-bottom: 12px; }
    li { margin-bottom: 6px; color: var(--text); }
    .highlight {
      background: var(--surface);
      border-left: 3px solid var(--primary);
      border-radius: 0 8px 8px 0;
      padding: 12px 16px;
      margin: 12px 0;
      font-size: 0.95rem;
    }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .contact-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-top: 12px;
    }
    .contact-card p { margin: 0; font-size: 0.95rem; }
    footer {
      text-align: center;
      color: var(--muted);
      font-size: 0.8rem;
      margin-top: 40px;
    }
  </style>
</head>
<body>

<header>
  <div class="logo">R</div>
  <div>
    <h1>River Song AI</h1>
    <p>Personal AI Operating System</p>
  </div>
</header>

<div class="wrapper">

  <div class="hero">
    <h2>Privacy Policy</h2>
    <p>Your data stays yours. River Song AI is built local-first — your conversations,
    memories, and personal data are stored on your own hardware, not on our servers.</p>
    <span class="updated">Last updated: May 10, 2026</span>
  </div>

  <section>
    <h3>1. Who We Are</h3>
    <p>River Song AI is a personal AI assistant application developed and operated by Cheryl
    (the &ldquo;Developer&rdquo;). The application runs on privately owned hardware and is
    accessed via the web interface at <strong>riversongai.com</strong> and through the
    River Song AI Android application.</p>
    <p>Contact: <a href="mailto:chrisjoe12374@gmail.com">chrisjoe12374@gmail.com</a></p>
  </section>

  <section>
    <h3>2. Local-First Architecture</h3>
    <div class="highlight">
      River Song AI runs on your own server. Your conversation history, memory facts,
      preferences, and personal data are stored in a SQLite database on privately owned
      hardware — not on any cloud platform controlled by third parties.
    </div>
    <p>Data does not leave your server except in the specific cases listed below, and only
    when you have explicitly connected an external service.</p>
  </section>

  <section>
    <h3>3. Data We Collect and How It Is Used</h3>

    <p><strong>Voice and Audio</strong></p>
    <p>When you use the voice conversation feature, your microphone audio is recorded and
    transmitted over an encrypted WebSocket connection (WSS) to your private River Song AI
    server. Audio is processed by Whisper (speech-to-text) locally on your server. Audio
    is not retained after transcription.</p>

    <p><strong>Conversation History</strong></p>
    <p>Text conversations and voice transcripts are stored locally on your server to provide
    context for future conversations. You can reset or clear history at any time from within
    the app.</p>

    <p><strong>Memory and Preferences</strong></p>
    <p>Facts and preferences you share with River Song AI are stored locally in the database
    on your server. These are used to personalize responses. You can view, edit, and delete
    all stored memory from the Memory section of the app.</p>

    <p><strong>Account Information</strong></p>
    <p>Your email address and display name are stored locally on your server for
    authentication purposes. Passwords are stored as secure hashes and are never stored
    in plain text.</p>

    <p><strong>Google Services (Optional)</strong></p>
    <p>If you choose to connect your Google account, River Song AI will access your Google
    Calendar events and Gmail messages on your behalf. OAuth tokens are stored locally on
    your server. Google data is only fetched when you request it and is not cached
    beyond your session. You can disconnect Google at any time from the Settings screen.</p>

    <p><strong>Reading Services (Optional)</strong></p>
    <p>If you connect Audible, Kindle, Libby, or Google Play Books, River Song AI accesses
    your book library and reading progress from those services. Service credentials and
    OAuth tokens are stored locally on your server. You can disconnect any reading service
    at any time.</p>

    <p><strong>Home Automation (Optional)</strong></p>
    <p>If you connect Home Assistant, River Song AI sends commands to your local Home
    Assistant instance. All communication is local-network only. No smart home data
    is transmitted to external servers.</p>

    <p><strong>Analytics Data (Optional)</strong></p>
    <p>If you configure social media analytics, River Song AI stores metric snapshots
    (follower counts, revenue figures, engagement data) locally on your server. This data
    is not shared with any third party.</p>

    <p><strong>Usage Data</strong></p>
    <p>River Song AI does not collect usage analytics, crash reports, or telemetry data.
    No information about how you use the app is transmitted to the Developer.</p>
  </section>

  <section>
    <h3>4. Data Sharing</h3>
    <p>We do not sell, rent, or share your personal data with any third party.</p>
    <p>Data is transmitted to external services only when you have explicitly configured
    those integrations (Google, Audible, Libby, etc.). In each case, data is transmitted
    directly between your server and the external service — it does not pass through any
    Developer-controlled infrastructure.</p>
    <p>When using cloud AI models (Claude, Gemini, OpenAI) for conversation, your message
    text is transmitted to the respective provider according to their terms of service.
    Local models (Ollama) process all data on your own hardware with no external
    transmission.</p>
  </section>

  <section>
    <h3>5. Microphone and Audio Access</h3>
    <p>The River Song AI Android app requests microphone permission for the voice
    conversation feature. Audio is:</p>
    <ul>
      <li>Recorded only when you tap the microphone button or trigger a voice session</li>
      <li>Transmitted over an encrypted connection (WSS/HTTPS) to your private server</li>
      <li>Processed locally by Whisper for speech-to-text transcription</li>
      <li>Not retained as audio after transcription is complete</li>
      <li>Never transmitted to the Developer or any third party</li>
    </ul>
    <p>You can revoke microphone permission at any time from your device settings.
    Revoking microphone access disables the voice conversation feature but does not
    affect text chat or any other functionality.</p>
  </section>

  <section>
    <h3>6. Data Storage and Security</h3>
    <p>All data is stored on privately owned server hardware. The Developer does not have
    access to your data unless you explicitly provide access.</p>
    <p>Security measures in place:</p>
    <ul>
      <li>All network traffic is encrypted via HTTPS/TLS (Cloudflare Tunnel)</li>
      <li>Passwords are stored using secure hashing (never plain text)</li>
      <li>Authentication uses signed JWT tokens with expiration</li>
      <li>The Android app uses Android Keystore for secure credential storage</li>
    </ul>
  </section>

  <section>
    <h3>7. Your Rights and Controls</h3>
    <p>Because data is stored on your own server, you have full control at all times:</p>
    <ul>
      <li><strong>View:</strong> All memory, conversations, and preferences are visible in the app</li>
      <li><strong>Delete:</strong> Individual facts, sessions, and preferences can be deleted from within the app</li>
      <li><strong>Export:</strong> Database files are accessible directly on your server</li>
      <li><strong>Disconnect services:</strong> Any connected integration (Google, Audible, etc.) can be disconnected from Settings</li>
      <li><strong>Account deletion:</strong> Removing your account deletes all associated data from the local database</li>
    </ul>
  </section>

  <section>
    <h3>8. Children&rsquo;s Privacy</h3>
    <p>River Song AI is not directed at children under the age of 13. We do not knowingly
    collect personal information from children under 13. If you believe a child has
    provided personal information through this application, please contact us so we can
    delete it.</p>
  </section>

  <section>
    <h3>9. Changes to This Policy</h3>
    <p>We may update this Privacy Policy from time to time. When we do, the &ldquo;Last
    updated&rdquo; date at the top of this page will change. Continued use of River Song
    AI after changes are posted constitutes acceptance of the updated policy.</p>
  </section>

  <section>
    <h3>10. Contact</h3>
    <p>If you have any questions about this Privacy Policy or how your data is handled,
    please contact:</p>
    <div class="contact-card">
      <p><strong>River Song AI</strong></p>
      <p>Email: <a href="mailto:chrisjoe12374@gmail.com">chrisjoe12374@gmail.com</a></p>
      <p>Website: <a href="https://riversongai.com">riversongai.com</a></p>
    </div>
  </section>

  <footer>
    <p>&copy; 2026 River Song AI &mdash; All rights reserved</p>
  </footer>

</div>
</body>
</html>"""


@router.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy():
    return _PRIVACY_HTML
