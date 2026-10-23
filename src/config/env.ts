import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DEFAULT_GROQ_MODEL } from '../ai/models.ts';

config();

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export const env = {
  dbPath: resolve(str('DB_PATH', './data/pilot.db')),
  profilesDir: resolve(str('PROFILES_DIR', './data/profiles')),
  port: Number(str('PORT', '4310')),
  // Loopback by default. The dashboard hands the API token to whoever loads it,
  // and the API can post to a real LinkedIn account, so binding this to every
  // interface puts both on the local network. Override only on purpose.
  // Loopback only unless BIND_ALLOW_NON_LOOPBACK=true AND API_TOKEN is set.
  bindHost: str('BIND_HOST', '127.0.0.1'),
  bindAllowNonLoopback: bool('BIND_ALLOW_NON_LOOPBACK', false),
  apiToken: str('API_TOKEN', ''),
  // High-risk social features. Off unless the operator opts in.
  outreachEnabled: bool('OUTREACH_ENABLED', false),
  engageFeedEnabled: bool('ENGAGE_FEED_ENABLED', false),
  // Workspace MCP writes: when true, still go through Approvals (never auto).
  workspaceMcpWrites: bool('WORKSPACE_MCP_WRITES', false),
  anthropicApiKey: str('ANTHROPIC_API_KEY', ''),
  // Paid models are opt-in. A key sitting in
  // .env is not consent to spend it: the key was being preferred over the free
  // provider simply because it existed.
  aiPaid: str('AI_PAID', '') === 'true',
  aiModel: str('AI_MODEL', 'claude-opus-5'),
  // Free lane, and the default: these posts are short and template-bound.
  groqApiKey: str('GROQ_API_KEY', ''),
  groqModel: str('GROQ_MODEL', DEFAULT_GROQ_MODEL),
  // xAI Grok (OpenAI-compatible). GROK_API_KEY is accepted as an alias.
  // Used when set and Groq is not. Force with AI_PROVIDER=xai.
  xaiApiKey: str('XAI_API_KEY', '') || str('GROK_API_KEY', ''),
  xaiModel: str('XAI_MODEL', '') || str('GROK_MODEL', 'grok-4.7'),
  // Optional force: anthropic | groq | xai | mock (empty = auto pick).
  aiProvider: str('AI_PROVIDER', ''),
  // Mic STT. Prefer Groq Whisper when GROQ_API_KEY is set; else xAI STT when
  // XAI_API_KEY is set (same key as Grok chat). Audio stays in memory only.
  groqSttModel: str('GROQ_STT_MODEL', 'whisper-large-v3-turbo'),
  xaiSttModel: str('XAI_STT_MODEL', 'grok-voice-transcribe-2.0'),
  // Grok TTS voice id (ara = warm; eve = energetic). Same XAI_API_KEY as chat.
  xaiTtsVoice: str('XAI_TTS_VOICE', 'ara'),
  // Optional Azure Neural TTS (Nigerian English). Text leaves the machine when used.
  azureSpeechKey: str('AZURE_SPEECH_KEY', ''),
  azureSpeechRegion: str('AZURE_SPEECH_REGION', ''),
  azureTtsVoice: str('AZURE_TTS_VOICE', 'en-NG-EzinneNeural'),
  // browser | azure | xai | auto (azure → xai → browser)
  ttsProvider: str('TTS_PROVIDER', 'auto'),
  headless: bool('HEADLESS', false),
  paused: bool('PAUSED', false),
  // Personal VA defaults. Africa/Lagos for the founding user; override in .env.
  homeTimezone: str('HOME_TIMEZONE', 'Africa/Lagos'),
  notifyEmail: str('NOTIFY_EMAIL', ''),
  smtpHost: str('SMTP_HOST', ''),
  smtpPort: Number(str('SMTP_PORT', '587')),
  smtpUser: str('SMTP_USER', ''),
  smtpPass: str('SMTP_PASS', ''),
  smtpFrom: str('SMTP_FROM', ''),
  googleClientId: str('GOOGLE_CLIENT_ID', ''),
  googleClientSecret: str('GOOGLE_CLIENT_SECRET', ''),
  // Open-source Google Workspace MCP (Gmail, Calendar, Drive, Docs, People).
  // Example: uvx workspace-mcp   or   npx -y @aaronsb/google-workspace-mcp
  workspaceMcpCommand: str('WORKSPACE_MCP_COMMAND', ''),
  workspaceMcpArgs: str('WORKSPACE_MCP_ARGS', ''),
  // Private SearXNG for web research (Workstream G). Empty = memory/KB only.
  // Example: http://127.0.0.1:8080 after deploy/searxng/compose.yml
  searxngUrl: str('SEARXNG_URL', ''),
  searxngTimeoutMs: Number(str('SEARXNG_TIMEOUT_MS', '12000')),
  // Slack user OAuth token (xoxp-…). Acts as the owner; treat like a password.
  slackUserToken: str('SLACK_USER_TOKEN', ''),
  // Playwright MCP for general browser agency (not social profiles). Spike.
  // Example: PLAYWRIGHT_MCP_COMMAND=npx  PLAYWRIGHT_MCP_ARGS=@playwright/mcp@latest
  playwrightMcpCommand: str('PLAYWRIGHT_MCP_COMMAND', ''),
  playwrightMcpArgs: str('PLAYWRIGHT_MCP_ARGS', ''),
  // Self-hosted Vexa for meeting notes (Workstream E stub).
  vexaApiUrl: str('VEXA_API_URL', ''),
  vexaApiKey: str('VEXA_API_KEY', ''),
};

export type Env = typeof env;
