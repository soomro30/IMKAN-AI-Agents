# IMKAN Agents - Powered by SAAL.AI

Production-ready Electron desktop application for browser automation of UAE government portals (TAMM, Dari). Built with TypeScript and Stagehand AI framework.

![Version](https://img.shields.io/badge/version-1.4.0-blue)
![License](https://img.shields.io/badge/license-ISC-green)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

## 🎯 Features

### Modern Desktop Application
- **Zero Configuration** - Auto .env creation with bundled credentials
- **Cross-Platform** - Windows, macOS, and Linux support
- **Native File Upload** - Excel files via OS file picker
- **Live Console Output** - Real-time progress tracking
- **Organized Downloads** - Auto-organized by agent type and date
- **Modern UI** - IMKAN branding with industrial design

### Active Automation Agents (2)

#### 1. 🗺️ Dari Site Plan Agent
Fully automated site plan purchase and download using Dari Wallet with Excel-based plot data.

**Features:**
- Configurable service name and direct URL
- Account switching (optional)
- Dari Wallet balance verification
- Smart retry logic
- Cache clearing for fresh data
- AI-powered data extraction

#### 2. 📄 Dari Title Deed Agent
Fully automated title deed generation and download for Dari platform using Excel-based plot data.

**Features:**
- Batch processing from Excel
- Application ID tracking
- Smart download retry (5-minute intervals)
- Status detection
- Comprehensive final summary

## 🚀 Quick Start

### For End Users

#### macOS
1. Download `IMKAN Agents-1.4.0-arm64.dmg`
2. Double-click → Drag to Applications
3. Right-click → Open (first time only)
4. Enter mobile number → Upload Excel → Run agent

#### Windows
1. Download `IMKAN Agents Setup 1.4.0.exe`
2. Double-click installer → Follow wizard
3. Launch from Start Menu
4. Enter mobile number → Upload Excel → Run agent

**No technical setup required!** ✨

### For Developers

#### Prerequisites
- Node.js 18+
- npm or yarn
- macOS 10.13+ (for macOS builds)
- Windows 10+ (for Windows builds)

#### Installation

```bash
# Clone repository
git clone git@github.com:soomro30/IMKAN-AI-Agents.git
cd ai-automation-agent

# Install dependencies
npm install

# Setup API credentials (IMPORTANT!)
cp electron/credentials.example.js electron/credentials.js
# Edit electron/credentials.js and add your real API keys

# Build TypeScript
npm run build

# Run Electron app
npm run electron
```

**⚠️ IMPORTANT:** The `electron/credentials.js` file is excluded from git for security. You must create it locally from the example file and add your real API keys.

#### Fast Development Workflow

**Terminal 1:**
```bash
npm run build:watch
# or
tsc --watch
```

**Terminal 2:**
```bash
npm run electron:quick
```

Changes take 3-5 seconds instead of 15-20 seconds!

## 🛠️ Configuration

### Environment Variables

Create `.env` file (or use auto-generated one in Electron):

```env
# Browser Automation
BROWSERBASE_API_KEY=bb_live_...
BROWSERBASE_PROJECT_ID=...

# AI Model (RECOMMENDED - Improves reliability by 30-40%)
OPENAI_API_KEY=sk-...

# UAE Pass Authentication
TAMM_MOBILE_NUMBER=+971XXXXXXXXX
```

**Get OpenAI API Key:** https://platform.openai.com/api-keys

### Agent Configuration

**Dari Site Plan Agent Settings:**
- Service Name (default: "Site Plan")
- Service URL (optional - for faster navigation)
- Plot Column Index
- Account Switching
- Payment Mode (TEST/LIVE)
- Timeouts (captcha, UAE Pass)

All configurable via Electron UI!

## 📦 Building Installers

### macOS
```bash
npm run package:mac
```
**Output:** `release/IMKAN Agents-1.4.0-arm64.dmg` (122MB)

### Windows (on Windows PC)

**Step 1: Clone Repository on Windows**
```cmd
git clone git@github.com:soomro30/IMKAN-AI-Agents.git
cd IMKAN-AI-Agents
```

**Step 2: Setup Credentials (CRITICAL!)**
```cmd
copy electron\credentials.example.js electron\credentials.js
notepad electron\credentials.js
```
Add your real API keys to the file, then save and close.

**Step 3: Install and Build**
```cmd
npm install
npm run build
npm run package:win
```

**Output:** `release/IMKAN Agents Setup 1.4.0.exe` (140MB)

**⚠️ Note:** Cannot cross-compile from Mac to Windows reliably. Must build on actual Windows machine.

### Linux
```bash
npm run package:linux
```

## 🧠 AI-Powered Automation

### Stagehand v3 Integration

Built with Stagehand framework best practices:

1. **AI Model Configuration** - GPT-4o for enhanced reliability
2. **Smart Data Extraction** - Detailed natural language prompts
3. **Validation Before Actions** - observe() before critical steps
4. **Cache Management** - Hard reloads to prevent stale data
5. **Retry Logic** - Exponential backoff for network operations
6. **Fallback Strategies** - AI → Regex → Manual parsing

**Learn more:** https://docs.stagehand.dev

## 📊 Excel File Format

### Site Plan Agent
```
| Plot Number | ... |
|-------------|-----|
| A-101       | ... |
| B-205       | ... |
```

### Title Deed Agent
```
| Unit Name | Plot Id - ADM | ... |
|-----------|---------------|-----|
| Villa 1   | c5            | ... |
| Villa 2   | d7            | ... |
```

**Note:** Excel files are uploaded fresh each run - no need to store in project directory.

## 🎨 UI Features

- **IMKAN Logo** - Official branding in header
- **Dari Logo** - Official Abu Dhabi Dari branding
- **Industrial Design** - Sharp corners, professional look
- **Consistent Styling** - All inputs match in size and style
- **Live Console** - Real-time logs with emoji indicators
- **Settings Persistence** - Remembers your configuration

## 🐛 Troubleshooting

### macOS: "Unidentified developer" warning
**Solution:** Right-click app → Open → Open (first time only)

### Windows: Security warning
**Solution:** Click "More info" → "Run anyway"

### Agent fails to start
1. Check console output for errors
2. Verify .env file exists in app data directory
3. Ensure Excel file is not open elsewhere
4. Check mobile number format: +971XXXXXXXXX

### Downloads not found
**Locations:**
- macOS: `~/Library/Application Support/imkan-agents/Downloads/`
- Windows: `C:\Users\[Name]\AppData\Roaming\imkan-agents\Downloads\`
- Linux: `~/.config/imkan-agents/Downloads/`

Use "Open Downloads" button in app!

## 📖 Documentation

Comprehensive documentation in `CLAUDE.md`:
- Architecture details
- Agent workflows
- Development guide
- Troubleshooting
- Adding new agents
- Stagehand best practices

## 🔒 Security

- All credentials via environment variables
- No hardcoded API keys
- Renderer process isolation
- Secure IPC communication
- Auto .env creation in app data directory

## 📝 Scripts

```bash
# Development
npm run dev                   # CLI agent selector
npm run dev:dari-site-plan    # Run Site Plan agent (CLI)
npm run dev:dari-title-deed   # Run Title Deed agent (CLI)

# Electron
npm run electron              # Build + run Electron
npm run electron:quick        # Quick launch (no rebuild)
npm run electron:dev          # Watch mode with auto-reload

# Building
npm run build                 # Compile TypeScript
npm run typecheck             # Type validation

# Packaging
npm run package:mac           # macOS installer
npm run package:win           # Windows installer
npm run package:linux         # Linux installer
```

## 🏗️ Technology Stack

- **Desktop:** Electron 39.0+
- **Automation:** Stagehand 2.0+ (@browserbasehq/stagehand)
- **Language:** TypeScript 5.7+
- **Runtime:** Node.js (ES Modules)
- **Build:** electron-builder 26.0+
- **AI:** OpenAI GPT-4o (optional)
- **Excel:** xlsx library
- **Validation:** zod schemas

## 📄 License

ISC License - IMKAN

## 🙏 Credits

- **IMKAN** - Application owner
- **SAAL.AI** - AI automation platform
- **Stagehand** - Browser automation framework
- **Browserbase** - Browser infrastructure

---

**Version 1.4.0** - Added email notifications, enhanced UI consistency, and full Electron config integration.

For detailed documentation, see [CLAUDE.md](./CLAUDE.md)
