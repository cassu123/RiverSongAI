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
@router.get("/privacy-policy", response_class=HTMLResponse,
            include_in_schema=False)
async def privacy_policy():
    return _PRIVACY_HTML


_TERMS_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Terms of Service — River Song AI</title>
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
    .nav-links {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-top: 24px;
      font-size: 0.85rem;
    }
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
    <h2>Terms of Service</h2>
    <p>By using River Song AI, you agree to these terms. Please read them carefully.</p>
    <span class="updated">Last updated: May 13, 2026</span>
  </div>

  <section>
    <h3>1. Acceptance of Terms</h3>
    <p>By accessing or using River Song AI (&ldquo;the Application&rdquo;), you agree to be
    bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms,
    do not use the Application.</p>
    <p>These Terms apply to all users of River Song AI, including the web interface at
    <strong>riversongai.com</strong> and the River Song AI Android application.</p>
  </section>

  <section>
    <h3>2. Description of Service</h3>
    <p>River Song AI is a personal AI assistant application that runs on privately owned
    server hardware. The Application provides:</p>
    <ul>
      <li>AI-powered text and voice conversation</li>
      <li>Personal memory and preference management</li>
      <li>Integration with optional third-party services (Google, Audible, Home Assistant, etc.)</li>
      <li>Routine automation and scheduling</li>
      <li>Smart home control via Home Assistant</li>
    </ul>
    <div class="highlight">
      River Song AI is a self-hosted, personal-use application. It is not a commercial SaaS
      platform. Access is limited to authorised users only.
    </div>
  </section>

  <section>
    <h3>3. Authorised Use</h3>
    <p>Access to River Song AI is restricted to authorised users. You may not:</p>
    <ul>
      <li>Share your account credentials with any other person</li>
      <li>Attempt to gain unauthorised access to the server or any connected systems</li>
      <li>Use the Application to generate, store, or distribute illegal content</li>
      <li>Use the Application to harass, harm, or threaten any individual</li>
      <li>Reverse-engineer, decompile, or tamper with the Application</li>
      <li>Use the Application for any commercial purpose without explicit written consent</li>
    </ul>
  </section>

  <section>
    <h3>4. AI-Generated Content</h3>
    <p>River Song AI uses large language models (LLMs) including Claude, Gemini, OpenAI GPT,
    and locally hosted models to generate responses. You acknowledge that:</p>
    <ul>
      <li>AI responses may contain errors, inaccuracies, or outdated information</li>
      <li>AI-generated content does not constitute professional advice of any kind
      (medical, legal, financial, or otherwise)</li>
      <li>You are solely responsible for how you act on information provided by the Application</li>
      <li>When using cloud AI models, your messages are transmitted to the respective provider
      under their own terms of service</li>
    </ul>
  </section>

  <section>
    <h3>5. Third-Party Services</h3>
    <p>River Song AI optionally integrates with third-party services. Your use of those
    services is governed by their respective terms of service and privacy policies:</p>
    <ul>
      <li>Google (Calendar, Gmail) &mdash; <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google Terms of Service</a></li>
      <li>Anthropic Claude &mdash; <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener">Anthropic Terms</a></li>
      <li>OpenAI &mdash; <a href="https://openai.com/policies/terms-of-use" target="_blank" rel="noopener">OpenAI Terms</a></li>
      <li>Google Gemini &mdash; <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google Terms</a></li>
    </ul>
    <p>The Developer is not responsible for the availability, accuracy, or conduct of any
    third-party service.</p>
  </section>

  <section>
    <h3>6. Data and Privacy</h3>
    <p>Your use of River Song AI is also governed by our
    <a href="/privacy-policy">Privacy Policy</a>, which is incorporated into these Terms
    by reference. The Privacy Policy explains how data is stored and handled.</p>
    <p>In summary: your data is stored locally on privately owned hardware. The Developer
    does not access, sell, or share your personal data.</p>
  </section>

  <section>
    <h3>7. Availability and Uptime</h3>
    <p>River Song AI runs on private hardware and is provided on a best-effort basis.
    The Developer makes no guarantee of uptime, availability, or uninterrupted service.
    The Application may be offline for maintenance, updates, or hardware issues at any time
    without notice.</p>
  </section>

  <section>
    <h3>8. Limitation of Liability</h3>
    <p>To the fullest extent permitted by applicable law, the Developer shall not be liable
    for any indirect, incidental, special, consequential, or punitive damages arising from
    your use of or inability to use the Application, including but not limited to:</p>
    <ul>
      <li>Loss of data or corruption of data</li>
      <li>Errors or inaccuracies in AI-generated responses</li>
      <li>Interruption or unavailability of the service</li>
      <li>Actions taken based on AI-generated content</li>
    </ul>
    <p>The Application is provided &ldquo;as is&rdquo; without warranty of any kind, express
    or implied.</p>
  </section>

  <section>
    <h3>9. Changes to Terms</h3>
    <p>The Developer reserves the right to update these Terms at any time. When changes are
    made, the &ldquo;Last updated&rdquo; date at the top of this page will be revised.
    Continued use of River Song AI after changes are posted constitutes acceptance of the
    updated Terms.</p>
  </section>

  <section>
    <h3>10. Governing Law</h3>
    <p>These Terms are governed by and construed in accordance with applicable law.
    Any disputes arising from these Terms or your use of the Application shall be resolved
    through good-faith negotiation in the first instance.</p>
  </section>

  <section>
    <h3>11. Contact</h3>
    <p>If you have any questions about these Terms of Service, please contact:</p>
    <div class="contact-card">
      <p><strong>River Song AI</strong></p>
      <p>Email: <a href="mailto:chrisjoe12374@gmail.com">chrisjoe12374@gmail.com</a></p>
      <p>Website: <a href="https://riversongai.com">riversongai.com</a></p>
    </div>
  </section>

  <div class="nav-links">
    <a href="/privacy-policy">Privacy Policy</a>
    <a href="https://riversongai.com">Back to River Song AI</a>
  </div>

  <footer>
    <p>&copy; 2026 River Song AI &mdash; All rights reserved</p>
  </footer>

</div>
</body>
</html>"""


@router.get("/terms", response_class=HTMLResponse, include_in_schema=False)
@router.get("/terms-of-service", response_class=HTMLResponse,
            include_in_schema=False)
async def terms_of_service():
    return _TERMS_HTML
