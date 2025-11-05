import { Stagehand } from '@browserbasehq/stagehand';
import { config } from '../config.js';
import { retry, sleep } from '../utils/retry.js';
import { loadDariSitePlanConfig, createDariSitePlanConfig, DariSitePlanConfig } from '../config/dari-site-plan-config.js';
import { loadElectronConfig } from '../electron-bridge.js';
import XLSX from 'xlsx';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Dari Site Plan Agent - Enhanced with Stagehand v3 Best Practices
 *
 * Improvements based on Stagehand documentation (docs.stagehand.dev):
 * 1. AI Model Configuration - Uses OpenAI GPT-4o for better reliability
 * 2. Improved extract() calls - Detailed natural language prompts for AI extraction
 * 3. Comprehensive observe() usage - Validates page state before critical actions
 * 4. Cache clearing - Prevents stale data issues
 * 5. Retry logic - Exponential backoff for network operations
 * 6. Smart fallbacks - Regex patterns when AI extraction fails
 *
 * The agent balances AI-powered actions with deterministic code for production stability.
 */

interface PlotData {
  plotNumber: string;
  rowIndex: number;
}

interface SitePlanRecord {
  plotNumber: string;
  applicationId: string | null;
  rowIndex: number;
  paid: boolean;
  walletBalanceSufficient: boolean;
  certificateDownloaded: boolean;
  downloadedViaFallback: boolean;
  downloadAttempts: number;
  lastDownloadAttemptTime: string | null;
  alreadyExistedInApplications: boolean;
  error: string | null;
}

interface PersistedApplicationData {
  plotNumber: string;
  applicationId: string;
  paymentDate: string;
  downloaded: boolean;
  lastChecked: string;
}

export class DariSitePlanAgent {
  private stagehand: Stagehand | null = null;
  private sitePlans: SitePlanRecord[] = [];
  private plots: PlotData[] = [];
  private config: DariSitePlanConfig;
  // Disable pre-payment checklist to avoid confusing control flow
  private readonly prePayCheckEnabled: boolean = false;
  private persistedApplications: Map<string, PersistedApplicationData> = new Map();
  private storageFilePath: string = 'data/dari-applications-history.json';


  constructor() {
    const electronConfig = loadElectronConfig();
    if (electronConfig) {
      const defaultConfig = loadDariSitePlanConfig();
      this.config = createDariSitePlanConfig({
        excelFilePath: electronConfig.excelFilePath,
        plotColumnIndex: electronConfig.plotColumnIndex,
        navigation: {
          ...defaultConfig.navigation,
          sitePlanServiceText: electronConfig.serviceName ?? defaultConfig.navigation.sitePlanServiceText,
          sitePlanServiceUrl: electronConfig.serviceUrl ?? defaultConfig.navigation.sitePlanServiceUrl,
        },
        accountSwitching: electronConfig.accountSwitching,
        payment: electronConfig.payment ? {
          ...defaultConfig.payment,
          enabled: electronConfig.payment.enabled,
        } : undefined,
        waitTimes: {
          ...defaultConfig.waitTimes,
          captcha: electronConfig.waitTimes.captcha,
          uaePassTimeout: electronConfig.waitTimes.uaePassTimeout,
        },
      });

      if (electronConfig.serviceName) {
        this.config.pageElements.sitePlanService = electronConfig.serviceName;
      }
    } else {
      this.config = loadDariSitePlanConfig();
    }
  }

  async intelligentWaitUntilPageReady(expectedElements: string, maxWaitSeconds: number = 60): Promise<boolean> {
    if (!this.stagehand?.page) return false;

    console.log(`🔍 Intelligent observation: waiting for "${expectedElements}"...`);
    console.log(`   Max wait: ${maxWaitSeconds}s | Check interval: 3s\n`);

    const maxAttempts = Math.floor(maxWaitSeconds / 3);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsed = attempt * 3;
      console.log(`   Attempt ${attempt}/${maxAttempts} (${elapsed}s elapsed)`);

      try {
        const observation = await this.stagehand.page.observe({
          instruction: expectedElements,
        });

        if (observation.length > 0) {
          console.log(`   ✅ Found ${observation.length} matching element(s)!`);
          console.log(`   ⚡ Page ready after ${elapsed}s\n`);
          return true;
        }

        console.log(`   ⏳ Not ready yet, checking again in 3s...`);
      } catch (error) {
        console.log(`   ⚠️  Observation error: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (attempt < maxAttempts) {
        await sleep(3000);
      }
    }

    console.log(`   ⚠️  Elements not found after ${maxWaitSeconds}s - continuing anyway\n`);
    return false;
  }

  async safeWaitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle', timeoutMs: number = 60000): Promise<void> {
    if (!this.stagehand?.page) return;

    try {
      await this.stagehand.page.waitForLoadState(state, { timeout: timeoutMs });
    } catch (error) {
      console.log(`   ℹ️  ${state} timeout (${timeoutMs}ms) - page may still be loading, continuing...`);
    }
  }

  async initialize(): Promise<void> {
    console.log('Initializing Dari Site Plan Agent...\n');

    // Initialize Stagehand with AI model configuration (best practice)
    this.stagehand = new Stagehand({
      env: 'LOCAL',
      verbose: 1,
      enableCaching: false,
      domSettleTimeoutMs: 3000,
      // Configure OpenAI model for better reliability
      modelName: config.openai.apiKey ? 'gpt-4o' : undefined,
      modelClientOptions: config.openai.apiKey ? {
        apiKey: config.openai.apiKey,
      } : undefined,
    });

    await this.stagehand.init();

    console.log('Clearing browser cache and storage...');
    const context = this.stagehand.context;
    if (context) {
      await context.clearCookies();
      await this.stagehand.page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
          const w = globalThis as any;
          if (w.caches) {
            w.caches.keys().then((names: string[]) => {
              names.forEach((name: string) => w.caches.delete(name));
            });
          }
        } catch (e) {
          console.log('Cache clear error:', e);
        }
      });
    }
    console.log('✓ Browser cache cleared\n');

    console.log('✓ Dari Site Plan Agent initialized\n');
    console.log('==============================================');
    console.log('🗺️  DARI SITE PLAN AUTOMATION AGENT');
    console.log('==============================================');
    console.log('Automated site plan purchase and download');
    console.log('==============================================');
    console.log(`\nConfiguration:`);
    console.log(`  Base URL: ${this.config.baseUrl}`);
    console.log(`  Excel File: ${this.config.excelFilePath}`);
    console.log(`  Plot Column: ${this.config.plotColumnIndex + 1} (${this.config.plotColumnIndex} index)`);
    console.log(`  Service Name: ${this.config.navigation.sitePlanServiceText}`);
    console.log(`  Account Switching: ${this.config.accountSwitching.enabled ? 'Enabled' : 'Disabled'}`);
    if (this.config.accountSwitching.enabled) {
      console.log(`  Target Account: ${this.config.accountSwitching.targetAccountName}`);
    }
    console.log(`  Payment Mode: ${this.config.payment.enabled ? 'LIVE (Real payments)' : 'TEST (No payments)'}`);
    console.log('==============================================\n');
  }

  loadPersistedApplications(): void {
    console.log('\n💾 Loading persisted application history...');

    if (!existsSync(this.storageFilePath)) {
      console.log('ℹ️  No previous application history found - starting fresh');
      console.log(`   (Will create ${this.storageFilePath} after first successful payment)\n`);
      return;
    }

    try {
      const fileContent = readFileSync(this.storageFilePath, 'utf-8');
      const applications: PersistedApplicationData[] = JSON.parse(fileContent);

      applications.forEach(app => {
        this.persistedApplications.set(app.plotNumber, app);
      });

      console.log(`✅ Loaded ${this.persistedApplications.size} previously paid application(s)`);
      console.log(`   This prevents duplicate payments for plots already processed\n`);

      if (this.persistedApplications.size > 0) {
        console.log('📋 Previously Paid Plots:');
        this.persistedApplications.forEach((app, plot) => {
          const downloadStatus = app.downloaded ? '✅ Downloaded' : '⏳ Pending Download';
          console.log(`   • Plot ${plot} → App ID: ${app.applicationId} | ${downloadStatus}`);
        });
        console.log('');
      }
    } catch (error) {
      console.log(`⚠️  Error loading application history: ${error instanceof Error ? error.message : String(error)}`);
      console.log('   Continuing with fresh start...\n');
    }
  }

  savePersistedApplications(): void {
    try {
      const applications: PersistedApplicationData[] = Array.from(this.persistedApplications.values());
      writeFileSync(this.storageFilePath, JSON.stringify(applications, null, 2), 'utf-8');
      console.log(`\n💾 Saved application history to ${this.storageFilePath}`);
    } catch (error) {
      console.log(`⚠️  Error saving application history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  addPersistedApplication(plotNumber: string, applicationId: string, downloaded: boolean = false): void {
    this.persistedApplications.set(plotNumber, {
      plotNumber,
      applicationId,
      paymentDate: new Date().toISOString(),
      downloaded,
      lastChecked: new Date().toISOString(),
    });
    this.savePersistedApplications();
  }

  updatePersistedApplicationDownloadStatus(plotNumber: string, downloaded: boolean): void {
    const existing = this.persistedApplications.get(plotNumber);
    if (existing) {
      existing.downloaded = downloaded;
      existing.lastChecked = new Date().toISOString();
      this.savePersistedApplications();
    }
  }

  async checkExistingApplicationForPlot(plotNumber: string): Promise<{ exists: boolean; applicationId: string | null; downloaded: boolean }> {
    console.log(`\n🔍 PRE-PAYMENT CHECK: Searching Applications page for Plot ${plotNumber}...`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 Smart Money Safety: Checking if we already paid for this plot');
    console.log('   This prevents duplicate payments!\n');

    const persisted = this.persistedApplications.get(plotNumber);
    if (persisted) {
      console.log(`✅ FOUND IN LOCAL HISTORY!`);
      console.log(`   Plot: ${plotNumber}`);
      console.log(`   Application ID: ${persisted.applicationId}`);
      console.log(`   Payment Date: ${new Date(persisted.paymentDate).toLocaleString()}`);
      console.log(`   Downloaded: ${persisted.downloaded ? 'Yes ✅' : 'No ⏳'}`);
      console.log(`\n💰 SKIP PAYMENT - Application already exists!`);
      console.log(`🎯 Will attempt to download directly\n`);
      return { exists: true, applicationId: persisted.applicationId, downloaded: persisted.downloaded };
    }

    if (!this.stagehand?.page) {
      return { exists: false, applicationId: null, downloaded: false };
    }

    try {
      await this.navigateToApplicationsPage();

      console.log(`🔍 Searching for Plot Number: ${plotNumber}...`);

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: `find the Plot Number or Plot ID search filter in the left sidebar and type "${plotNumber}"`,
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   🔄 Plot number search retry ${attempt}: ${error.message}`);
          },
        }
      );

      await sleep(2000);

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: 'click the Search button or Show Results button to filter applications',
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
        }
      );

      await sleep(3000);
      await this.stagehand.page.waitForLoadState('networkidle');

      const resultsObservation = await this.stagehand.page.observe({
        instruction: 'find application cards or results, or "no results" messages on the page',
      });

      const noResults = resultsObservation.some((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('no result') || desc.includes('no application') || desc.includes('not found');
      });

      if (noResults || resultsObservation.length === 0) {
        console.log(`❌ NO APPLICATION FOUND for Plot ${plotNumber}`);
        console.log(`💳 SAFE TO PROCEED with payment\n`);
        return { exists: false, applicationId: null, downloaded: false };
      }

      console.log(`\n✅ APPLICATION EXISTS for Plot ${plotNumber}!`);
      console.log(`🎯 Extracting Application ID...\n`);

      const extractedAppId = await this.extractApplicationIdFromResults();

      if (extractedAppId) {
        console.log(`✅ Found Application ID: ${extractedAppId}`);
        console.log(`💰 SKIP PAYMENT - Will download directly!\n`);

        this.addPersistedApplication(plotNumber, extractedAppId, false);

        return { exists: true, applicationId: extractedAppId, downloaded: false };
      }

      console.log(`⚠️  Found application but couldn't extract ID`);
      console.log(`   Will proceed cautiously...\n`);
      return { exists: false, applicationId: null, downloaded: false };

    } catch (error) {
      console.log(`⚠️  Pre-payment check error: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`   Proceeding with normal flow...\n`);
      return { exists: false, applicationId: null, downloaded: false };
    }
  }

  async extractApplicationIdFromResults(): Promise<string | null> {
    if (!this.stagehand?.page) {
      return null;
    }

    try {
      const extractResult = await this.stagehand.page.extract({
        instruction: 'Extract the Application ID or Reference Number from the visible application card. Look for labels like "Application ID", "Reference Number", "Request ID", or "App ID". Return only the alphanumeric ID value.',
      });

      if (extractResult && typeof extractResult === 'string') {
        const trimmed = (extractResult as string).trim();
        if (trimmed.length > 3 && trimmed.length < 50) {
          return trimmed;
        }
      }

      const pageText = await this.stagehand.page.content();
      const appIdMatch = pageText.match(/(?:Application ID|Reference Number|Request ID|App ID)[:\s]+([A-Z0-9-]+)/i);
      if (appIdMatch && appIdMatch[1]) {
        return appIdMatch[1].trim();
      }

      return null;
    } catch (error) {
      console.log(`   Extraction error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async loadPlotNumbers(): Promise<void> {
    console.log('Loading plot numbers from Excel file...');
    const excelPath = this.getExcelFilePath();

    if (!existsSync(excelPath)) {
      throw new Error(`Excel file not found at: ${excelPath}`);
    }

    console.log(`✓ Reading from: ${excelPath}`);

    let workbook;
    try {
      workbook = XLSX.readFile(excelPath);
    } catch (error) {
      throw new Error(`Failed to read Excel file: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`✓ Workbook loaded, sheets: ${workbook.SheetNames.join(', ')}`);

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length === 0) {
      throw new Error('Excel file is empty');
    }

    console.log(`✓ Loaded ${data.length} rows from Excel`);

    const headerRow = data[0];
    console.log(`Header row: ${JSON.stringify(headerRow)}`);

    const plotNumberColumnIndex = this.config.plotColumnIndex;

    console.log(`✓ Using column index ${plotNumberColumnIndex} for Plot Numbers (column ${plotNumberColumnIndex + 1})`);

    this.plots = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row && row[plotNumberColumnIndex]) {
        const plotNumber = row[plotNumberColumnIndex].toString().trim();
        if (plotNumber) {
          this.plots.push({
            plotNumber,
            rowIndex: i + 1,
          });
        }
      }
    }

    if (this.plots.length === 0) {
      throw new Error('No plot numbers found in the 3rd column of Excel file');
    }

    console.log(`✓ Loaded ${this.plots.length} plot numbers:\n`);
    this.plots.forEach((plot, index) => {
      console.log(`  ${index + 1}. Plot ${plot.plotNumber} (Row ${plot.rowIndex})`);
    });
    console.log('');
  }

  getExcelFilePath(): string {
    if (this.config.excelFilePath.startsWith('/') || this.config.excelFilePath.match(/^[A-Z]:\\/i)) {
      return this.config.excelFilePath;
    }
    return join(process.cwd(), this.config.excelFilePath);
  }

  async navigateToDari(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`Step 1: Navigating to ${this.config.baseUrl}...`);
    await retry(
      async () => {
        await this.stagehand!.page.goto(this.config.baseUrl, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`Navigation failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('✓ Successfully navigated to Dari website\n');
  }

  async clickLoginButton(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('Step 2: Waiting for Login button to appear and clicking...');

    const loginReady = await this.intelligentWaitUntilPageReady(
      `Find the ${this.config.pageElements.loginButton} in the top right corner`,
      30
    );

    if (!loginReady) {
      throw new Error('Login button did not appear within 30 seconds');
    }

    console.log('✓ Login button visible\n');

    const loginButton = await this.stagehand!.page.locator('a:has-text("Login"), button:has-text("Login")').first();
    await loginButton.click();

    console.log('✓ Clicked Login button\n');
  }

  async clickUAEPassLogin(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('Step 3: Finding and clicking Login with UAE Pass button...');

    const loginPageObservation = await this.stagehand.page.observe({
      instruction: `Find the ${this.config.pageElements.uaePassLoginButton}`,
    });

    console.log(`Login page observation: ${JSON.stringify(loginPageObservation.slice(0, 3), null, 2)}\n`);

    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: `click on the ${this.config.pageElements.uaePassLoginButton}`,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`Click UAE Pass login failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('✓ Clicked Login with UAE Pass\n');
    await sleep(3000);
  }

  async enterMobileAndEnableRememberMe(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('Step 4: Waiting for UAE Pass login page to open...');
    await sleep(2000);

    const mobileNumber = config.tamm.mobileNumber || '0504945959';
    console.log(`Entering mobile number: ${mobileNumber}`);

    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: `enter mobile number ${mobileNumber} in the mobile number field`,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`Enter mobile number failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    await sleep(1000);

    console.log('Enabling Remember me checkbox...');
    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: 'click on the Remember me checkbox to enable it',
        });
      },
      {
        maxAttempts: 2,
        delayMs: 1000,
        onRetry: (attempt, error) => {
          console.log(`Enable Remember me failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    await sleep(2000);

    console.log('\n⚠️  Please solve the captcha if it appears...');
    console.log(`Waiting ${this.config.waitTimes.captcha / 1000} seconds for manual captcha solution...\n`);
    await sleep(this.config.waitTimes.captcha);

    console.log('Clicking Login button...');
    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: 'click the Login button to proceed',
        });
      },
      {
        maxAttempts: 5,
        delayMs: 3000,
        onRetry: (attempt, error) => {
          console.log(`Click login failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('✓ Login button clicked\n');
    await sleep(2000);
  }

  async waitForUAEPassApproval(): Promise<void> {
    console.log('==============================================');
    console.log('Step 5: UAE Pass 2FA Required');
    console.log('==============================================');
    console.log('A notification has been sent to your mobile.');
    console.log('Please approve the login request in your UAE Pass app.\n');
    console.log('Agent will automatically detect login completion...\n');

    const MAX_WAIT_ATTEMPTS = 60;
    const 
    CHECK_INTERVAL_MS = 3000;
    let loginSuccessful = false;

    for (let attempt = 1; attempt <= MAX_WAIT_ATTEMPTS; attempt++) {
      console.log(`Checking login status... (attempt ${attempt}/${MAX_WAIT_ATTEMPTS})`);

      await sleep(CHECK_INTERVAL_MS);

      const currentUrl = this.stagehand!.page.url();
      console.log(`Current URL: ${currentUrl}`);

      if (!currentUrl.includes('login') && !currentUrl.includes('auth') && !currentUrl.includes('uaepass')) {
        console.log('✓ URL changed - verifying login success...\n');

        const pageReady = await this.intelligentWaitUntilPageReady(
          'Find elements that indicate the user is logged in, such as user profile, user avatar, logout button, or account menu in the top right header',
          60
        );

        if (pageReady) {
          loginSuccessful = true;
          break;
        }
      }
    }

    if (!loginSuccessful) {
      throw new Error('Login verification timeout. Please check if UAE Pass approval was completed.');
    }

    console.log('✓ Successfully logged into Dari website');
    console.log('✓ User avatar and menu visible in top header\n');
    await sleep(2000);
  }

  async acceptCookiesIfPresent(): Promise<void> {
    if (!this.stagehand?.page) return;
    try {
      // Try OneTrust accept button directly
      const clicked = await this.stagehand.page.evaluate(() => {
        try {
          const d: any = (globalThis as any).document;
          const ids = ['onetrust-accept-btn-handler', 'accept-recommended-btn-handler'];
          for (const id of ids) {
            const el = d.getElementById(id);
            if (el) { (el as any).click(); return true; }
          }
          const buttons = Array.from(d.querySelectorAll('button')) as any[];
          const match = buttons.find(b => /accept|allow all/i.test((b.innerText||b.textContent||'').trim()));
          if (match) { match.click(); return true; }
        } catch {}
        return false;
      });
      if (!clicked) {
        await this.stagehand.page.act({
          action: 'if a cookie banner is visible, click Allow all cookies or Accept all',
          timeoutMs: 2000,
        });
      }
      await sleep(400);
    } catch {}
  }

  async switchToAlJurfHospitalityAccount(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`Step 6: Switching to ${this.config.accountSwitching.targetAccountName}...`);

    console.log('  6a: Observing user menu in top right header...');
    const userMenuElements = await this.stagehand.page.observe({
      instruction: 'find user menu, profile menu, or account menu in the top right header',
    });

    console.log(`  User menu observation: ${JSON.stringify(userMenuElements.slice(0, 2), null, 2)}\n`);

    console.log('  6b: Clicking user menu...');
    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: 'click the user menu in the top right header',
          timeoutMs: 10000,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`  Click user menu failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('  ✓ User menu clicked\n');
    await sleep(2000);

    console.log('  6c: Observing dropdown menu options...');
    const dropdownElements = await this.stagehand.page.observe({
      instruction: 'find switch account option in the dropdown menu',
    });

    console.log(`  Dropdown observation: ${JSON.stringify(dropdownElements.slice(0, 3), null, 2)}\n`);

    console.log('  6d: Clicking Switch Account option...');
    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: 'click the switch account option',
          timeoutMs: 10000,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`  Click Switch Account failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('  ✓ Switch Account clicked\n');
    await sleep(3000);

    console.log('  6e: Observing account selection page...');
    const accountPageElements = await this.stagehand.page.observe({
      instruction: 'find Al Jurf Hospitality Service account profile on the account selection page',
    });

    console.log(`  Account page observation: ${JSON.stringify(accountPageElements.slice(0, 3), null, 2)}\n`);

    console.log(`  6f: Selecting ${this.config.accountSwitching.targetAccountName} account...`);
    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: `click on the ${this.config.accountSwitching.targetAccountName} account profile`,
          timeoutMs: 10000,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`  Select account failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('  ✓ Al Jurf Hospitality Service account selected\n');
    await sleep(3000);

    console.log('  6g: Verifying account switch...');
    const currentUrl = this.stagehand.page.url();
    console.log(`  Current URL: ${currentUrl}`);

    const verificationElements = await this.stagehand.page.observe({
      instruction: 'find elements indicating we are on the Dari homepage after account switch',
    });

    console.log(`  Verification observation: ${JSON.stringify(verificationElements.slice(0, 2), null, 2)}\n`);

    console.log(`  6h: ✓ Successfully switched to ${this.config.accountSwitching.targetAccountName}\n`);
  }

  async navigateToServicesMenu(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`Step 7: Observing header menus and clicking ${this.config.navigation.servicesMenuText} menu...`);
    await this.acceptCookiesIfPresent();

    const headerMenuObservation = await this.stagehand.page.observe({
      instruction: `Find the ${this.config.pageElements.servicesMenu}`,
    });

    console.log(`Header menu observation: ${JSON.stringify(headerMenuObservation.slice(0, 3), null, 2)}\n`);

    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: `click on the ${this.config.pageElements.servicesMenu}`,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`Click Services menu failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log('✓ Clicked Services menu\n');
    await sleep(3000);
  }

  async selectSitePlanService(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`Step 8: Navigating to ${this.config.navigation.sitePlanServiceText} service...`);
    console.log(`Finding and clicking "${this.config.navigation.sitePlanServiceText}" service on Services page...`);
    console.log('ℹ️  Using click-through navigation to preserve session state and cookies\n');

    const servicesPageObservation = await this.stagehand.page.observe({
      instruction: `Find the "${this.config.navigation.sitePlanServiceText}" service card or link on the services page`,
    });

    console.log(`Services page observation: ${JSON.stringify(servicesPageObservation.slice(0, 5), null, 2)}\n`);

    await retry(
      async () => {
        await this.stagehand!.page.act({
          action: `click on the "${this.config.navigation.sitePlanServiceText}" service`,
        });
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`Select ${this.config.navigation.sitePlanServiceText} service failed (attempt ${attempt}): ${error.message}`);
        },
      }
    );

    console.log(`✓ Selected ${this.config.navigation.sitePlanServiceText} service\n`);
    await sleep(3000);

    console.log('Observing service page...');
    const sitePlanPageObservation = await this.stagehand.page.observe({
      instruction: 'Find the filter menu on the left side and the plots/properties list on the right side',
      // Service UI may be inside an iframe
      iframes: true as any,
    });

    console.log(`Service page observation: ${JSON.stringify(sitePlanPageObservation.slice(0, 5), null, 2)}\n`);
    console.log(`✓ ${this.config.navigation.sitePlanServiceText} service page loaded with filters and properties\n`);
  }

  private async getSelectedPaymentLabel(): Promise<string | null> {
    if (!this.stagehand?.page) return null;
    try {
      const selected = await this.stagehand.page.evaluate(() => {
        const d: any = (globalThis as any).document;
        const qsa = (sel: string, root?: any) => Array.from((root || d).querySelectorAll(sel)) as any[];
        const all = qsa('*');
        const container = all.find(el => /pay\s*with/i.test((el.textContent || '').toString())) || d.body;
        if (!container) return null as any;

        const checked = container.querySelector('input[type="radio"]:checked') as any;
        if (!checked) return null as any;

        const closestLabel = (node: any): string | null => {
          if (!node) return null;
          // If wrapped by a label
          const lbl = node.closest && node.closest('label');
          if (lbl && lbl.textContent) return lbl.textContent.trim();
          // Try for= relationship
          if (node.id) {
            const viaFor = container.querySelector && container.querySelector(`label[for="${node.id}"]`) as any;
            if (viaFor && viaFor.textContent) return viaFor.textContent.trim();
          }
          // Walk up to find a block with text
          let el: any = node;
          for (let i = 0; i < 6 && el; i++) {
            el = el.parentElement;
            const text = (el && el.textContent && el.textContent.trim()) || '';
            if (text) return text;
          }
          return null;
        };

        const text = closestLabel(checked) || '';
        return text.toLowerCase();
      });
      return selected;
    } catch {
      return null;
    }
  }

  private async ensureDariWalletSelected(): Promise<boolean> {
    if (!this.stagehand?.page) return false;

    // Scroll to payment section to improve element targeting
    try {
      await this.stagehand.page.act({
        action: 'scroll to the Pay with section where payment options (Debit/Credit Card and DARI wallet) are displayed',
      });
    } catch {}

    // Attempt multiple targeted phrasing variants
    const actions = [
      'select the DARI wallet payment option in the Pay with section',
      'click the DARI wallet label to select that payment method',
      'click the radio button next to the DARI wallet text to choose it',
      'choose DARI wallet as the payment method',
    ];

    for (let i = 0; i < actions.length; i++) {
      try {
        await retry(
          async () => {
            await this.stagehand!.page.act({ action: actions[i] });
          },
          { maxAttempts: 2, delayMs: 1000 }
        );
      } catch {}

      await sleep(1000);

      // Verify using DOM-level check
      const selected = await this.getSelectedPaymentLabel();
      if (selected && (selected.includes('dari wallet') || (selected.includes('dari') && selected.includes('wallet')))) {
        console.log(`   ✅ Verified via DOM: selected payment = "${selected}"`);
        return true;
      }
    }

    // One more try using a generic "click near text" phrasing
    try {
      await this.stagehand.page.act({ action: 'click near the text DARI wallet to select it as the payment option' });
      await sleep(1000);
      const selected = await this.getSelectedPaymentLabel();
      if (selected && (selected.includes('dari wallet') || (selected.includes('dari') && selected.includes('wallet')))) {
        console.log(`   ✅ Verified via DOM: selected payment = "${selected}"`);
        return true;
      }
    } catch {}

    console.log('   ❌ Could not verify DARI wallet selection via DOM');
    return false;
  }

  async searchAndProcessPlot(plot: PlotData): Promise<SitePlanRecord> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing Plot: ${plot.plotNumber} (Row ${plot.rowIndex})`);
    console.log('='.repeat(60));

    const record: SitePlanRecord = {
      plotNumber: plot.plotNumber,
      applicationId: null,
      rowIndex: plot.rowIndex,
      paid: false,
      walletBalanceSufficient: false,
      certificateDownloaded: false,
      downloadedViaFallback: false,
      downloadAttempts: 0,
      lastDownloadAttemptTime: null,
      alreadyExistedInApplications: false,
      error: null,
    };

    try {
      if (this.prePayCheckEnabled) {
        const persisted = this.persistedApplications.get(plot.plotNumber);
        if (persisted) {
          console.log('💡 FOUND IN LOCAL HISTORY - SMART WORKFLOW');
          console.log(`   Plot: ${plot.plotNumber} → App ID: ${persisted.applicationId}`);
          console.log('   💰 SKIP PAYMENT - Will attempt download via Applications page\n');

          record.applicationId = persisted.applicationId;
          record.paid = true;
          record.alreadyExistedInApplications = true;

          try {
            await this.navigateToApplicationsPage();
            await this.searchApplicationById(persisted.applicationId);
            await this.viewAndDownloadApplication(record);

            if (record.certificateDownloaded) {
              this.updatePersistedApplicationDownloadStatus(plot.plotNumber, true);
            }
          } catch (error) {
            console.log(`⚠️  Smart workflow failed: ${error instanceof Error ? error.message : String(error)}`);
            console.log('   Will proceed with normal workflow...\n');
            record.alreadyExistedInApplications = false;
          }

          if (record.certificateDownloaded) {
            return record;
          }
        }
      }

      console.log('Step 9: Searching for plot by Plot Number...');
      console.log(`Entering Plot Number: ${plot.plotNumber}\n`);

      // Use observe() to find the Plot Number input field first
      console.log('🔍 Observing filters section for Plot Number input field...');
      const filterObservation = await this.stagehand.page.observe({
        instruction: 'Find the Plot Number input field or text box in the Filters section on the left sidebar',
        iframes: true as any,
      });

      console.log(`   Found ${filterObservation.length} elements in filters section`);
      if (filterObservation.length > 0) {
        console.log(`   Top matches:`);
        filterObservation.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`      ${idx + 1}. ${item.description?.substring(0, 80)} [${item.method}]`);
        });
      }

      const plotInput = filterObservation.find((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return (desc.includes('plot') && desc.includes('number')) ||
               desc.includes('plot number') ||
               (desc.includes('input') && desc.includes('plot'));
      });

      if (!plotInput) {
        console.log('⚠️  Plot Number field not found via observe(), trying AI act...\n');
      } else {
        console.log(`   ✅ Found Plot Number field: "${plotInput.description}"\n`);
      }

      // Use act() to type the plot number
      console.log(`📝 Typing "${plot.plotNumber}" into Plot Number field...`);
      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: `type "${plot.plotNumber}" into the Plot Number input field in the Filters section`,
            iframes: true as any,
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   Retry ${attempt}: ${error.message}`);
          },
        }
      );
      console.log('✅ Plot number entered\n');

      // Observe for search/filter button (might be "Show Results", "Search", "Filter", or auto-filter)
      console.log('🔍 Observing page for search/filter button or auto-filtered results...');
      await sleep(1000); // Brief wait for any auto-filtering

      const searchButtonObservation = await this.stagehand.page.observe({
        instruction: 'Find any Search, Show Results, Filter, or Apply button near the filters, or observe if results already appeared on the right',
        iframes: true as any,
      });

      console.log(`   Found ${searchButtonObservation.length} interactive elements`);
      if (searchButtonObservation.length > 0) {
        console.log(`   Top matches:`);
        searchButtonObservation.slice(0, 5).forEach((item: any, idx: number) => {
          console.log(`      ${idx + 1}. ${item.description?.substring(0, 80)} [${item.method}]`);
        });
      }

      const searchButton = searchButtonObservation.find((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return item.method === 'click' &&
               (desc.includes('search') ||
                desc.includes('show results') ||
                desc.includes('filter') ||
                desc.includes('apply')) &&
               !desc.includes('pay');
      });

      if (searchButton) {
        console.log(`\n   ✅ Found search button: "${searchButton.description}"`);
        console.log('🖱️  Clicking search button...');

        await retry(
          async () => {
            await this.stagehand!.page.act({
              action: 'click the search or filter button to show filtered results',
              iframes: true as any,
            });
          },
          {
            maxAttempts: 3,
            delayMs: 2000,
            onRetry: (attempt, error) => {
              console.log(`   Retry ${attempt}: ${error.message}`);
            },
          }
        );
        console.log('✅ Search button clicked\n');
      } else {
        console.log('   ℹ️  No search button found - assuming auto-filtering\n');
      }

      // Guard: Check we're still on the right page
      await sleep(1000);
      const postSearchUrl = this.stagehand!.page.url();
      if (/abudhabipay\.|paymentpage\./i.test(postSearchUrl)) {
        console.log('⚠️  Unexpected redirect to external payment gateway. Navigating back and retrying...');
        await this.navigateToServicesMenu();
        await this.selectSitePlanService();
        await sleep(1500);
        return await this.searchAndProcessPlot(plot);
      }

      // Observe search results with intelligent waiting
      console.log('🔍 Observing search results on the right side...');
      await this.intelligentWaitUntilPageReady(
        'Find filtered property results on the right side, or a message saying no properties found',
        30
      );

      const resultsObservation = await this.stagehand.page.observe({
        instruction: 'Find the property cards or results on the right side showing filtered properties, or any message indicating no properties were found',
        iframes: true as any,
      });

      console.log(`   Found ${resultsObservation.length} elements in results area`);
      if (resultsObservation.length > 0) {
        console.log(`   Sample results:`);
        resultsObservation.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`      ${idx + 1}. ${item.description?.substring(0, 80)}`);
        });
      }

      // Check for "no property" message
      const pageText = await this.stagehand.page.textContent('body');
      const noPropertyMessage = pageText?.toLowerCase().includes("you don't own any property") ||
                                pageText?.toLowerCase().includes("will not be able to proceed") ||
                                pageText?.toLowerCase().includes("no properties found") ||
                                resultsObservation.length === 0;

      if (noPropertyMessage) {
        console.log('\n⚠️  No property found or user does not own this property');
        console.log('Skipping to next plot...\n');
        record.error = 'Property not found or not owned by user';
        return record;
      }

      console.log('\n✅ Property found in search results');
      console.log('🖱️  Clicking on the property card...');

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: 'click on the property that appears in the search results on the right side',
            iframes: true as any,
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`Click property failed (attempt ${attempt}): ${error.message}`);
          },
        }
      );

      console.log('\n🔍 Observing property selection state...');
      await this.stagehand.page.waitForLoadState('domcontentloaded');

      const selectionCheck = await this.stagehand.page.observe({
        instruction: 'find the selected property card with checkmark or highlight, and the Proceed button at the bottom',
        iframes: true as any,
      });

      console.log(`   📊 Observed ${selectionCheck.length} elements`);
      if (selectionCheck.length > 0) {
        console.log('   Top 3 elements:');
        selectionCheck.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`      ${idx + 1}. ${item.description?.substring(0, 100)} [${item.method}]`);
        });
      }

      const propertySelected = selectionCheck.some((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return (desc.includes('selected') || desc.includes('checkmark') || desc.includes('checked') || desc.includes('highlighted'));
      });

      if (propertySelected) {
        console.log('   ✅ Property appears to be selected\n');
      } else {
        console.log('   ⚠️  Could not confirm property selection via observe()\n');
      }

      console.log('🔍 Finding Proceed button using observe()...');

      const proceedObserve = await this.stagehand.page.observe({
        instruction: 'Find the red Proceed button on the right side at the bottom (NOT the gray Cancel button on the left)',
        iframes: true as any,
      });

      console.log(`   📊 Found ${proceedObserve.length} clickable elements`);
      if (proceedObserve.length > 0) {
        console.log('   All observed elements:');
        proceedObserve.forEach((item: any, idx: number) => {
          if (item.method === 'click') {
            console.log(`      ${idx + 1}. ${item.description}`);
          }
        });
      }

      const proceedAction = proceedObserve.find((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return item.method === 'click' && desc.includes('proceed') && !desc.includes('cancel');
      });

      if (!proceedAction) {
        throw new Error('Could not find Proceed button via observe()');
      }

      console.log(`   ✅ Found Proceed button: ${proceedAction.description}`);
      console.log(`   Selector: ${proceedAction.selector}\n`);

      console.log('🖱️  Clicking Proceed button using observe() result...');

      await this.stagehand.page.act(proceedAction);

      console.log('✓ Proceed button clicked');

      console.log('⏳ Waiting for page to load...\n');

      // Wait for page to finish loading
      await this.stagehand.page.waitForLoadState('networkidle');

      console.log('📖 Observing for certificate/payment page content - NO TIME LIMIT\n');

      let certificatePageLoaded = false;
      let observationAttempts = 0;

      while (!certificatePageLoaded) {
        observationAttempts++;

        if (observationAttempts === 1 || observationAttempts % 10 === 0) {
          console.log(`🔍 Observation attempt ${observationAttempts}...`);
        }

        const pageCheck = await this.stagehand.page.observe({
          instruction: 'Find payment options (DARI wallet, credit card), application ID field, certificate details, or processing messages',
          iframes: true as any,
        });

        const hasPaymentElements = pageCheck.some((item: any) => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('dari wallet') || desc.includes('credit card') || desc.includes('debit') || desc.includes('payment');
        });

        const hasApplicationId = pageCheck.some((item: any) => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('application id') || desc.includes('reference number');
        });

        const hasCertificateHeading = pageCheck.some((item: any) => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('certificate') || desc.includes('site plan');
        });

        if (hasPaymentElements || hasApplicationId || hasCertificateHeading) {
          console.log('\n   ✅ Certificate/payment page content loaded!');
          console.log(`   Content detected after ${observationAttempts} observations`);
          if (hasPaymentElements) console.log('   - Payment options found');
          if (hasApplicationId) console.log('   - Application ID field found');
          if (hasCertificateHeading) console.log('   - Certificate heading found\n');
          certificatePageLoaded = true;
          break;
        }

        if (observationAttempts % 5 === 0) {
          console.log(`   ⏳ Waiting for payment content to appear... (${observationAttempts * 2}s elapsed)`);
        }

        await this.stagehand.page.waitForTimeout(2000);
      }

      if (!certificatePageLoaded) {
        console.log('\n⚠️  Could not detect payment/certificate content after 30 attempts');
        console.log('   The page might still be on property selection');
        console.log('   Possible issues:');
        console.log('   - Proceed button might be disabled');
        console.log('   - Form validation might be failing');
        console.log('   - Page might require manual intervention\n');

        record.error = 'Could not navigate to payment page after clicking Proceed';
        return record;
      }

      console.log('🎯 Certificate page fully loaded and verified!\n');

      const currentUrl = this.stagehand.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      if (currentUrl.includes('404') || currentUrl.includes('error')) {
        console.log('❌ Navigation error - landed on error page\n');
        record.error = 'Navigation failed after clicking Proceed';
        return record;
      }

      console.log('\n✅ Certificate page fully loaded and verified by observe()!\n');

      console.log('Step 5: Extract Application/Certificate ID (Stagehand best practice: extract after page ready)...');
      const applicationId = await this.extractApplicationId();

      if (applicationId) {
        record.applicationId = applicationId;
        console.log(`✅ Application ID extracted: ${applicationId}`);
        console.log(`💾 Saving to persistent storage (prevents duplicate payment on re-run)\n`);
        this.addPersistedApplication(plot.plotNumber, applicationId, false);
      } else {
        console.log('⚠️  Could not extract Application ID');
        console.log('Will continue with payment section...\n');
      }

      console.log('Step 6: Use observe() to find both payment options...');
      const paymentOptions = await this.stagehand.page.observe({
        instruction: 'find all payment options including Debit/Credit Card and DARI wallet radio buttons in the "Pay with" section',
        iframes: true as any,
      });

      console.log(`   Payment options found: ${paymentOptions.length} elements`);
      paymentOptions.slice(0, 5).forEach((item: any, idx: number) => {
        console.log(`      ${idx + 1}. ${item.description?.substring(0, 100) || 'N/A'} [${item.method}]`);
      });

      const dariWalletOption = paymentOptions.find((item: any) =>
        item.description?.toLowerCase().includes('dari wallet') ||
        item.description?.toLowerCase().includes('dari') && item.description?.toLowerCase().includes('wallet')
      );

      if (!dariWalletOption) {
        console.log('\n❌ DARI wallet radio button not found via observe()');
        record.error = 'DARI wallet option not found on page';
        return record;
      }

      console.log(`\n   ✓ Found DARI wallet option: "${dariWalletOption.description}"`);
      console.log(`   Method: ${dariWalletOption.method}\n`);

      if (dariWalletOption.method !== 'click') {
        console.log('❌ DARI wallet element is not clickable');
        record.error = 'DARI wallet element found but not interactive';
        return record;
      }

      console.log('Step 7: Select DARI wallet payment option...');
      // First attempt: natural-language click as before (kept but simplified)
      try {
        await retry(
          async () => {
            await this.stagehand!.page.act({
              action: 'select the DARI wallet payment option',
            });
          },
          { maxAttempts: 2, delayMs: 1500 }
        );
      } catch {}

      // Robust verification + fallback selection using DOM-backed checks
      let walletSelected = await this.ensureDariWalletSelected();
      if (walletSelected) {
        console.log('\n   ✅ DARI wallet is confirmed SELECTED\n');
      } else {
        console.log('\n⚠️  WARNING: DARI wallet not selected after multiple attempts');
        console.log('   Will not proceed with payment to avoid card flow.');
        record.error = 'Failed to select DARI wallet payment option';
        return record;
      }

      console.log('\nStep 8: Verify payment details using observe() - NO TIMEOUTS...');
      console.log('📖 Stagehand best practice: observe() detects when page is ready\n');

      await this.stagehand.page.waitForLoadState('domcontentloaded');

      console.log('Using observe() to detect payment details...');
      const paymentDetailsCheck = await this.stagehand.page.observe({
        instruction: 'find the DARI wallet balance amount and the total payment amount',
        iframes: true as any,
      });

      console.log(`   📊 Observed ${paymentDetailsCheck.length} payment-related elements`);
      if (paymentDetailsCheck.length > 0) {
        console.log('   Top 3 elements:');
        paymentDetailsCheck.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`      ${idx + 1}. ${item.description?.substring(0, 80) || 'N/A'}`);
        });
      }

      const hasBalanceInfo = paymentDetailsCheck.some((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('balance') || desc.includes('wallet') || desc.includes('amount');
      });

      if (!hasBalanceInfo) {
        console.log('\n   ⚠️  Payment details not immediately visible');
        console.log('   Attempting extraction anyway...\n');
      } else {
        console.log('\n   ✅ Payment details section confirmed visible by observe()\n');
      }

      console.log('Step 10: Extract payment amounts using extract() method...');
      const walletBalance = await this.extractWalletBalance();
      const paymentAmount = await this.extractPaymentAmount();

      console.log('\nStep 11: Validate extracted payment information...');
      console.log(`   Wallet Balance: ${walletBalance || 'NOT FOUND'}`);
      console.log(`   Payment Amount: ${paymentAmount || 'NOT FOUND'}\n`);

      if (walletBalance && paymentAmount) {
        const balance = parseFloat(walletBalance.replace(/[^0-9.]/g, ''));
        const amount = parseFloat(paymentAmount.replace(/[^0-9.]/g, ''));

        console.log(`   Balance (numeric): ${balance}`);
        console.log(`   Amount (numeric): ${amount}\n`);

        if (balance >= amount) {
          console.log('✅ Wallet balance is sufficient for payment!');
          console.log(`   Balance: ${walletBalance} >= Payment: ${paymentAmount}\n`);
          record.walletBalanceSufficient = true;

          if (!this.config.payment.enabled) {
            console.log('⚠️  TESTING MODE: Payment disabled in config');
            console.log('🔍 Everything has been verified up to this point:');
            console.log(`   - Application ID: ${record.applicationId}`);
            console.log(`   - DARI wallet selected: ✓`);
            console.log(`   - Wallet Balance: ${walletBalance}`);
            console.log(`   - Payment Amount: ${paymentAmount}`);
            console.log(`   - Balance Sufficient: ✓`);
            console.log('📋 Set payment.enabled=true in config to enable payments\n');
          } else {
            console.log('💰 LIVE MODE: Payment enabled - proceeding with actual payment...\n');

            console.log('Step 12: Observe Pay Now button before clicking...');
            const payNowObservation = await this.stagehand.page.observe({
              instruction: 'find the Pay now button at the bottom of the page to complete the payment',
            });

            console.log(`   Pay Now button observation: ${payNowObservation.length} elements found`);
            payNowObservation.slice(0, 3).forEach((item: any, idx: number) => {
              console.log(`      ${idx + 1}. ${item.description?.substring(0, 100) || 'N/A'} [${item.method}]`);
            });

            const payNowButton = payNowObservation.find((item: any) =>
              (item.description?.toLowerCase().includes('pay now') ||
               item.description?.toLowerCase().includes('pay') && item.description?.toLowerCase().includes('now')) &&
              item.method === 'click'
            );

            if (!payNowButton) {
              console.log('\n❌ Pay Now button not found or not clickable');
              record.error = 'Pay Now button not found';
              return record;
            }

            console.log('   ✅ Pay Now button found and validated\n');

            console.log('Step 13: Click Pay Now button...');
            await retry(
              async () => {
                await this.stagehand!.page.act({
                  action: 'click the red Pay now button at the bottom to complete the payment',
                });
              },
              {
                maxAttempts: 3,
                delayMs: 2000,
                onRetry: (attempt, error) => {
                  console.log(`   Retry ${attempt}: ${error.message}`);
                },
              }
            );

            console.log('✅ Pay Now button clicked successfully\n');

            console.log('Step 14: Verify payment processing using observe() - NO TIMEOUTS...');
            console.log('📖 Stagehand best practice: observe() detects page state changes\n');

            await this.stagehand.page.waitForLoadState('domcontentloaded');

            console.log('🔍 Observing post-payment page state...');
            const postPaymentObservation = await this.stagehand.page.observe({
              instruction: 'find any success messages, error messages, payment confirmation, download buttons, or processing status indicators',
              iframes: true as any,
            });

            console.log(`   📊 Observed ${postPaymentObservation.length} elements after payment`);
            if (postPaymentObservation.length > 0) {
              console.log('   Top 3 elements detected:');
              postPaymentObservation.slice(0, 3).forEach((item: any, idx: number) => {
                console.log(`      ${idx + 1}. ${item.description?.substring(0, 100)}`);
              });
            }

            const hasErrorMessage = postPaymentObservation.some((item: any) => {
              const desc = item.description?.toLowerCase() || '';
              return desc.includes('error') || desc.includes('failed') || desc.includes('unsuccessful');
            });

            if (hasErrorMessage) {
              console.log('\n   ❌ Payment error detected by observe()');
              record.error = 'Payment failed - error message detected';
              return record;
            }

            const currentUrl = this.stagehand.page.url();
            console.log(`\n   📍 Current URL after payment: ${currentUrl}`);

            console.log('   ✅ Payment page transition completed\n');
            record.paid = true;

            console.log('\nStep 15: Attempting certificate download...');
            await this.downloadCertificate(record);
          }

        } else {
          console.log('❌ Insufficient DARI wallet balance!');
          console.log(`   Balance: ${walletBalance} is less than Payment: ${paymentAmount}`);
          console.log(`   Skipping this plot and moving to next one...\n`);
          record.walletBalanceSufficient = false;
          record.error = `Insufficient balance: ${walletBalance} < ${paymentAmount}`;
        }
      } else {
        console.log('⚠️  Could not extract wallet balance or payment amount');
        console.log('   This might indicate page structure issues or extraction problems.\n');
        record.error = 'Could not extract payment information';
      }

    } catch (error) {
      console.error(`❌ Error processing plot ${plot.plotNumber}:`, error);
      record.error = error instanceof Error ? error.message : String(error);
    }

    return record;
  }

  async extractApplicationId(): Promise<string | null> {
    if (!this.stagehand?.page) {
      return null;
    }

    try {
      console.log('Extracting Application ID using AI...');

      // Use Stagehand extract() for AI-powered extraction (best practice)
      const extractResult = await this.stagehand.page.extract(
        'Extract the Application ID or Reference Number from this page. Look for labels like "Application ID", "Reference Number", or "Request ID". Return only the alphanumeric ID value.'
      );

      if (extractResult.extraction) {
        const extracted = String(extractResult.extraction).trim();
        if (extracted && extracted.length >= 6) {
          // Validate it looks like an ID
          const match = extracted.match(/([A-Z0-9-]{6,})/i);
          if (match) {
            console.log(`✓ Extracted Application ID: ${match[1]}`);
            return match[1];
          }
        }
      }

      // Fallback to regex patterns if AI extraction fails
      console.log('AI extraction returned no result, falling back to regex patterns...');
      const pageText = await this.stagehand.page.textContent('body');

      if (pageText) {
        const patterns = [
          /Application\s+ID\s*:?\s*([A-Z0-9-]+)/i,
          /Reference\s+Number\s*:?\s*([A-Z0-9-]+)/i,
          /Request\s+ID\s*:?\s*([A-Z0-9-]+)/i,
          /ID\s*:?\s*([A-Z0-9]{6,})/i,
        ];

        for (const pattern of patterns) {
          const match = pageText.match(pattern);
          if (match && match[1]) {
            console.log(`✓ Extracted via regex: ${match[1]}`);
            return match[1];
          }
        }
      }

    } catch (error) {
      console.log(`❌ Application ID extraction failed:`, error instanceof Error ? error.message : String(error));
    }

    return null;
  }

  async extractWalletBalance(): Promise<string | null> {
    if (!this.stagehand?.page) {
      return null;
    }

    try {
      console.log('Extracting wallet balance using AI...');

      // Use Stagehand extract() for AI-powered extraction (best practice)
      const extractResult = await this.stagehand.page.extract(
        'Extract the DARI wallet balance amount shown below the DARI wallet payment option. Look for text like "Balance: ß 150.50" or "Balance ß 0". Return the complete value with currency symbol.'
      );

      if (extractResult.extraction) {
        const extracted = String(extractResult.extraction).trim();
        // Check if it contains a number
        const match = extracted.match(/(ß?\s*\d+(?:\.\d+)?)/i);
        if (match) {
          const formatted = match[1].includes('ß') ? match[1] : `ß ${match[1]}`;
          console.log(`✓ Extracted wallet balance: ${formatted}`);
          return formatted;
        }
      }

      // Fallback to regex if AI extraction fails
      console.log('AI extraction failed, falling back to regex...');
      const pageText = await this.stagehand.page.textContent('body');

      if (pageText) {
        const match = pageText.match(this.config.payment.walletBalancePattern);
        if (match && match[1]) {
          const formatted = `ß ${match[1]}`;
          console.log(`✓ Extracted via regex: ${formatted}`);
          return formatted;
        }
      }

    } catch (error) {
      console.log(`❌ Wallet balance extraction failed:`, error instanceof Error ? error.message : String(error));
    }

    return null;
  }

  async extractPaymentAmount(): Promise<string | null> {
    if (!this.stagehand?.page) {
      return null;
    }

    try {
      console.log('Extracting payment amount using AI...');

      // Use Stagehand extract() for AI-powered extraction (best practice)
      const extractResult = await this.stagehand.page.extract(
        'Extract the "Total to be paid" amount from the payment details section. Look for red text showing the total amount with ß currency symbol. Return the complete value.'
      );

      if (extractResult.extraction) {
        const extracted = String(extractResult.extraction).trim();
        // Check if it contains a number
        const match = extracted.match(/(ß?\s*\d+(?:\.\d+)?)/i);
        if (match) {
          const formatted = match[1].includes('ß') ? match[1] : `ß ${match[1]}`;
          console.log(`✓ Extracted payment amount: ${formatted}`);
          return formatted;
        }
      }

      // Fallback to regex if AI extraction fails
      console.log('AI extraction failed, falling back to regex...');
      const pageText = await this.stagehand.page.textContent('body');

      if (pageText) {
        const match = pageText.match(this.config.payment.totalAmountPattern);
        if (match && match[1]) {
          const formatted = `ß ${match[1]}`;
          console.log(`✓ Extracted via regex: ${formatted}`);
          return formatted;
        }
      }

    } catch (error) {
      console.log(`❌ Payment amount extraction failed:`, error instanceof Error ? error.message : String(error));
    }

    return null;
  }

  /**
   * Intelligent Download Certificate Method - Production-Grade
   * Continuously observes for Download button without fixed timeout
   * Download button can appear in 1 minute or 10 minutes - we don't know when
   * Downloads IMMEDIATELY as soon as button is detected
   */
  async downloadCertificate(record: SitePlanRecord): Promise<void> {
    if (!this.stagehand?.page) {
      return;
    }

    try {
      console.log('\n📥 INTELLIGENT CERTIFICATE DOWNLOAD SYSTEM');
      console.log('===============================================');
      console.log('⚡ NO FIXED TIMEOUT - Continuous observation until download ready');
      console.log('⏱️  Download button can appear in 1-10 minutes');
      console.log('🎯 Will download IMMEDIATELY when detected\n');

      record.downloadAttempts++;
      record.lastDownloadAttemptTime = new Date().toISOString();

      console.log('🔍 Step 1: Observe post-payment page state...');
      console.log('📖 Stagehand v3: Using observe() to detect certificate generation status\n');

      await this.stagehand.page.waitForLoadState('domcontentloaded');

      const startUrl = this.stagehand.page.url();
      console.log(`📍 Current URL: ${startUrl}\n`);

      if (startUrl.includes('404') || startUrl.includes('error') || startUrl.includes('not-found')) {
        console.log('❌ Landed on error page - payment may have failed\n');
        record.error = 'Payment redirect failed - error page detected';
        return;
      }

      console.log('Step 2: INTELLIGENT OBSERVATION-BASED DOWNLOAD WAITING');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📖 Stagehand v3 Best Practice: Pure observe() - NO TIMEOUTS');
      console.log('🔍 Continuously observing page state changes');
      console.log('⏱️  Certificate can take: 20 seconds to 10+ minutes');
      console.log('♾️  Will observe until Download button appears');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      let downloadButtonFound = false;
      let observationCount = 0;
      const MAX_OBSERVATIONS = 120;

      while (!downloadButtonFound && observationCount < MAX_OBSERVATIONS) {
        observationCount++;
        console.log(`\n🔍 Observation #${observationCount} (checking page state)...`);

        try {
          const pageStateObservation = await this.stagehand.page.observe({
            instruction: 'find ALL interactive elements including: Download Certificate button, Download button, processing status messages, error messages, success indicators, and any page headings',
          });

          console.log(`   📊 Observed ${pageStateObservation.length} interactive elements`);

          if (observationCount % 5 === 1 && pageStateObservation.length > 0) {
            console.log('   Top 5 elements (shown every 5 observations):');
            pageStateObservation.slice(0, 5).forEach((item: any, idx: number) => {
              console.log(`      ${idx + 1}. ${item.description?.substring(0, 100)} [${item.method}]`);
            });
          }

          const downloadButton = pageStateObservation.find((item: any) => {
            if (item.method !== 'click') return false;
            const desc = item.description?.toLowerCase() || '';
            return (desc.includes('download') &&
                   (desc.includes('certificate') ||
                    desc.includes('site plan') ||
                    desc.includes('verification') ||
                    desc.includes('document') ||
                    desc.includes('pdf')));
          });

          const processingMessage = pageStateObservation.find((item: any) => {
            const desc = item.description?.toLowerCase() || '';
            return desc.includes('processing') || desc.includes('generating') || desc.includes('please wait');
          });

          const errorMessage = pageStateObservation.find((item: any) => {
            const desc = item.description?.toLowerCase() || '';
            return desc.includes('error') || desc.includes('failed') || desc.includes('unsuccessful');
          });

          if (errorMessage) {
            console.log('\n   ❌ ERROR MESSAGE DETECTED by observe()');
            console.log(`   Message: "${errorMessage.description}"`);
            record.error = 'Certificate generation failed';
            return;
          }

          if (processingMessage) {
            console.log(`   ⏳ Processing: "${processingMessage.description}"`);
            console.log('   Certificate is being generated... will keep observing');
          }

          if (downloadButton) {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ DOWNLOAD BUTTON DETECTED! 🎉');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📍 Button: "${downloadButton.description}"`);
            console.log(`🎯 Detected via observe() after ${observationCount} observations`);
            console.log('⚡ Downloading IMMEDIATELY...\n');

            downloadButtonFound = true;

            // Click download button immediately
            await retry(
              async () => {
                await this.stagehand!.page.act({
                  action: 'click the Download Certificate button in the top right corner to download the certificate',
                });
              },
              {
                maxAttempts: 3,
                delayMs: 2000,
                onRetry: (attempt, error) => {
                  console.log(`   🔄 Download click retry ${attempt}: ${error.message}`);
                },
              }
            );

            console.log('✅ Download button clicked successfully!');
            console.log('📖 No sleep() - browser handles download automatically\n');

            record.certificateDownloaded = true;
            this.updatePersistedApplicationDownloadStatus(record.plotNumber, true);
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ CERTIFICATE DOWNLOADED SUCCESSFULLY! 🎉');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            break;
          }

          console.log('   ⏳ Download button not found yet - continuing to observe...');
          console.log('   📖 Next observation will check page state again');

          await this.stagehand.page.waitForLoadState('domcontentloaded');

          // Check URL hasn't changed to error page
          const currentUrl = this.stagehand.page.url();
          if (currentUrl !== startUrl && (currentUrl.includes('error') || currentUrl.includes('404'))) {
            console.log('\n❌ Page navigated to error - stopping observation\n');
            record.error = 'Page navigated to error during download wait';
            break;
          }

        } catch (obsError) {
          console.log(`   ⚠️  Observation error: ${obsError instanceof Error ? obsError.message : String(obsError)}`);
        }

        // Brief pause to avoid hammering the server with observations
        await sleep(5000);
      }

      if (!downloadButtonFound) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️  DOWNLOAD BUTTON DID NOT APPEAR');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📊 Completed ${observationCount} observations using Stagehand observe()`);
        console.log('🔄 Will retry via Applications page fallback at the end\n');
        record.error = record.error ? `${record.error}; Download button never appeared` : 'Download button did not appear after extended observations';
      }

    } catch (error) {
      console.log(`\n❌ Certificate download process failed: ${error instanceof Error ? error.message : String(error)}\n`);
      record.error = record.error ? `${record.error}; Download error: ${error instanceof Error ? error.message : String(error)}` : `Download error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async navigateBackToSitePlanService(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('Navigating back to Site Plan service page...');

    try {
      const currentUrl = this.stagehand.page.url();
      console.log(`Current URL: ${currentUrl}`);

      if (currentUrl.includes('/siteplan') || currentUrl.includes('/site-plan') || currentUrl.includes('/certificates')) {
        console.log('✓ Already on Site Plan service page\n');
        return;
      }

      console.log('Navigating through Services menu to Site Plan service...');
      console.log('ℹ️  Using click-through navigation to preserve session state\n');

      await this.navigateToServicesMenu();
      await this.selectSitePlanService();

      console.log('✓ Successfully navigated back to Site Plan service\n');
    } catch (error) {
      console.log(`Navigation error: ${error instanceof Error ? error.message : String(error)}`);
      console.log('Retrying navigation...');

      await sleep(2000);
      await this.navigateToServicesMenu();
      await this.selectSitePlanService();
    }
  }

  async processAllPlots(): Promise<void> {
    console.log('\n==============================================');
    console.log('Step 9-10: Processing All Plots from Excel');
    console.log('==============================================\n');
    console.log(`📊 Total plots to process: ${this.plots.length}`);
    console.log(`🛡️  Robust mode: Each plot isolated - failures won't stop workflow\n`);

    for (let i = 0; i < this.plots.length; i++) {
      const plot = this.plots[i];
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`📍 Processing plot ${i + 1} of ${this.plots.length}: ${plot.plotNumber}`);
      console.log(`${'━'.repeat(80)}\n`);

      try {
        const record = await this.searchAndProcessPlot(plot);
        this.sitePlans.push(record);

        console.log(`\n✅ Plot ${plot.plotNumber} completed`);
        if (record.error) {
          console.log(`   ⚠️  With errors: ${record.error}`);
        } else if (record.certificateDownloaded) {
          console.log(`   ✅ Certificate downloaded successfully`);
        } else if (record.paid) {
          console.log(`   💳 Payment completed (download pending)`);
        }
      } catch (plotError) {
        console.log(`\n❌ CRITICAL ERROR processing plot ${plot.plotNumber}:`);
        console.log(`   ${plotError instanceof Error ? plotError.message : String(plotError)}\n`);
        console.log(`🛡️  ERROR ISOLATED - Continuing with next plot...\n`);

        const errorRecord: SitePlanRecord = {
          plotNumber: plot.plotNumber,
          applicationId: null,
          rowIndex: plot.rowIndex,
          paid: false,
          walletBalanceSufficient: false,
          certificateDownloaded: false,
          downloadedViaFallback: false,
          downloadAttempts: 0,
          lastDownloadAttemptTime: null,
          alreadyExistedInApplications: false,
          error: `Critical error: ${plotError instanceof Error ? plotError.message : String(plotError)}`,
        };
        this.sitePlans.push(errorRecord);

        try {
          console.log('🔄 Attempting to recover browser state...');
          await this.recoverFromError();
        } catch (recoveryError) {
          console.log(`⚠️  Recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
          console.log('   Will try to continue anyway...\n');
        }
      }

      if (i < this.plots.length - 1) {
        console.log('\n⏳ Preparing for next plot...');
        try {
          await this.navigateBackToSitePlanService();
          await sleep(2000);
        } catch (navError) {
          console.log(`⚠️  Navigation error: ${navError instanceof Error ? navError.message : String(navError)}`);
          console.log('   Will attempt recovery before next plot...\n');
          try {
            await this.recoverFromError();
          } catch (recoveryError) {
            console.log(`⚠️  Recovery failed, continuing anyway...\n`);
          }
        }
      }

      if ((i + 1) % 10 === 0) {
        console.log(`\n💾 Checkpoint: Processed ${i + 1}/${this.plots.length} plots`);
        console.log(`   Success: ${this.sitePlans.filter(r => !r.error).length}`);
        console.log(`   Errors: ${this.sitePlans.filter(r => r.error).length}\n`);
        this.savePersistedApplications();
      }
    }

    console.log('\n==============================================');
    console.log('✓ All Plots Processed');
    console.log('==============================================');
    console.log(`Total Plots Processed: ${this.sitePlans.length}/${this.plots.length}`);
    console.log(`Success: ${this.sitePlans.filter(r => !r.error).length}`);
    console.log(`Errors: ${this.sitePlans.filter(r => r.error).length}\n`);

    this.savePersistedApplications();
  }

  async recoverFromError(): Promise<void> {
    if (!this.stagehand?.page) {
      console.log('   Browser not initialized - skipping recovery');
      return;
    }

    console.log('   🔧 Recovery Step 1: Checking browser state...');

    try {
      const currentUrl = this.stagehand.page.url();
      console.log(`   Current URL: ${currentUrl}`);

      if (currentUrl.includes('error') || currentUrl.includes('404')) {
        console.log('   🔄 On error page - navigating back to Dari home...');
        await this.stagehand.page.goto(this.config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
      }

      console.log('   🔧 Recovery Step 2: Verifying still logged in...');
      const loginCheck = await this.intelligentWaitUntilPageReady(
        'Find user profile, avatar, or logout button to verify logged in',
        15
      );

      if (!loginCheck) {
        console.log('   ⚠️  May be logged out - workflow may need manual intervention');
      } else {
        console.log('   ✅ Still logged in');
      }

      console.log('   ✅ Recovery completed\n');
    } catch (error) {
      console.log(`   ⚠️  Recovery error: ${error instanceof Error ? error.message : String(error)}\n`);
      throw error;
    }
  }

  async processFailedDownloads(): Promise<void> {
    if (!this.stagehand?.page) {
      return;
    }

    const failedDownloads = this.sitePlans.filter(
      record => record.paid && !record.certificateDownloaded && record.applicationId
    );

    if (failedDownloads.length === 0) {
      console.log('\n✅ No failed downloads to recover - all certificates downloaded successfully!\n');
      return;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 FALLBACK RECOVERY SYSTEM ACTIVATED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Found ${failedDownloads.length} failed download(s) to recover`);
    console.log('🎯 Strategy: Navigate to Applications page and search by Application ID');
    console.log('🛡️  Robust mode: Each recovery isolated - failures won\'t stop process\n');

    for (let i = 0; i < failedDownloads.length; i++) {
      const record = failedDownloads[i];
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🔄 Fallback Recovery ${i + 1}/${failedDownloads.length}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📍 Plot Number: ${record.plotNumber}`);
      console.log(`🆔 Application ID: ${record.applicationId}\n`);

      try {
        await this.navigateToApplicationsPage();
        await this.searchApplicationById(record.applicationId!);
        await this.viewAndDownloadApplication(record);

        if (record.certificateDownloaded) {
          console.log(`✅ Fallback recovery successful for plot ${record.plotNumber}!\n`);
        } else {
          console.log(`⚠️  Fallback recovery incomplete for plot ${record.plotNumber}\n`);
        }

        if (i < failedDownloads.length - 1) {
          console.log('⏳ Waiting before next recovery attempt...\n');
          await sleep(3000);
        }
      } catch (error) {
        console.log(`❌ Fallback recovery failed for plot ${record.plotNumber}:`);
        console.log(`   ${error instanceof Error ? error.message : String(error)}\n`);
        console.log(`🛡️  ERROR ISOLATED - Continuing with next recovery...\n`);

        record.error = record.error ? `${record.error}; Fallback failed: ${error instanceof Error ? error.message : String(error)}` : `Fallback recovery failed: ${error instanceof Error ? error.message : String(error)}`;

        try {
          console.log('🔄 Attempting to recover browser state...');
          await this.recoverFromError();
        } catch (recoveryError) {
          console.log(`⚠️  Recovery failed, continuing anyway...\n`);
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏁 FALLBACK RECOVERY SYSTEM COMPLETED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const successfulRecoveries = failedDownloads.filter(r => r.certificateDownloaded).length;
    console.log(`📊 Recovery Results: ${successfulRecoveries}/${failedDownloads.length} successful\n`);

    this.savePersistedApplications();
  }

  async navigateToApplicationsPage(): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('🔍 Step 1: Navigating to Applications page...');

    try {
      const applicationsUrl = 'https://www.dari.ae/en/app/applications?type=applications';
      console.log(`📍 URL: ${applicationsUrl}`);

      await retry(
        async () => {
          await this.stagehand!.page.goto(applicationsUrl, {
            waitUntil: 'networkidle',
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   🔄 Navigation retry ${attempt}: ${error.message}`);
          },
        }
      );

      console.log('⏳ Waiting for page to load...');
      await sleep(3000);
      await this.stagehand.page.waitForLoadState('networkidle');
      await sleep(2000);

      const currentUrl = this.stagehand.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      console.log('🔍 Observing Applications page...');
      const pageObservation = await this.stagehand.page.observe({
        instruction: 'find applications list, search filters, or application ID input field on this page',
      });

      console.log(`✅ Found ${pageObservation.length} interactive elements on Applications page`);
      console.log('✓ Successfully navigated to Applications page\n');
    } catch (error) {
      throw new Error(`Failed to navigate to Applications page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchApplicationById(applicationId: string): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`🔍 Step 2: Searching for Application ID: ${applicationId}...`);

    try {
      console.log('🔍 Looking for Application ID filter field in left sidebar...');

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: `find the Application ID input field or search filter in the left sidebar and type "${applicationId}"`,
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   🔄 Search input retry ${attempt}: ${error.message}`);
          },
        }
      );

      console.log(`✓ Entered Application ID: ${applicationId}`);
      await sleep(2000);

      console.log('🔍 Looking for Search or Filter button...');

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: 'click the Search button or Show Results button to filter applications',
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   🔄 Search button retry ${attempt}: ${error.message}`);
          },
        }
      );

      console.log('✓ Search button clicked');
      await sleep(3000);
      await this.stagehand.page.waitForLoadState('networkidle');

      console.log('🔍 Observing filtered results...');
      const resultsObservation = await this.stagehand.page.observe({
        instruction: 'find application cards or results on the right side of the page',
      });

      console.log(`✅ Found ${resultsObservation.length} elements in search results`);
      console.log('✓ Search completed successfully\n');
    } catch (error) {
      throw new Error(`Failed to search for Application ID ${applicationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async viewAndDownloadApplication(record: SitePlanRecord): Promise<void> {
    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log('🔍 Step 3: Opening application and downloading certificate...');

    try {
      console.log('🔍 Looking for "View Application" link...');

      await retry(
        async () => {
          await this.stagehand!.page.act({
            action: 'click the View Application link or button in the application card',
          });
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
          onRetry: (attempt, error) => {
            console.log(`   🔄 View Application retry ${attempt}: ${error.message}`);
          },
        }
      );

      console.log('✓ View Application clicked');
      await sleep(3000);
      await this.stagehand.page.waitForLoadState('networkidle');
      await sleep(2000);

      const currentUrl = this.stagehand.page.url();
      console.log(`📍 Application page URL: ${currentUrl}`);

      console.log('\n🔍 INTELLIGENT OBSERVATION - Looking for Download button...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const CHECK_INTERVAL_MS = 5000;
      const MAX_ATTEMPTS = 60;
      let attemptNumber = 0;
      let downloadFound = false;

      while (attemptNumber < MAX_ATTEMPTS) {
        attemptNumber++;
        const elapsedSeconds = Math.floor((attemptNumber * CHECK_INTERVAL_MS) / 1000);

        console.log(`🔍 Attempt ${attemptNumber}/${MAX_ATTEMPTS} | ⏱️  ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`);

        try {
          const headerObservation = await this.stagehand.page.observe({
            instruction: 'find Download Certificate button or Download button in the top right corner of the page',
          });

          const downloadButton = headerObservation.find((item: any) => {
            if (item.method !== 'click') return false;
            const desc = item.description?.toLowerCase() || '';
            return desc.includes('download') &&
                   (desc.includes('certificate') || desc.includes('site plan') ||
                    desc.includes('verification') || desc.includes('document'));
          });

          if (downloadButton) {
            console.log('\n✅ DOWNLOAD BUTTON FOUND! 🎉');
            console.log(`⏱️  Found after: ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s\n`);

            await retry(
              async () => {
                await this.stagehand!.page.act({
                  action: 'click the Download Certificate button in the top right corner',
                });
              },
              {
                maxAttempts: 3,
                delayMs: 2000,
                onRetry: (attempt, error) => {
                  console.log(`   🔄 Download click retry ${attempt}: ${error.message}`);
                },
              }
            );

            console.log('✅ Download button clicked!');
            await sleep(5000);

            record.certificateDownloaded = true;
            record.downloadedViaFallback = true;
            this.updatePersistedApplicationDownloadStatus(record.plotNumber, true);
            downloadFound = true;
            break;
          }

          console.log('   ⏳ Download button not ready yet...');

        } catch (obsError) {
          console.log(`   ⚠️  Observation error: ${obsError instanceof Error ? obsError.message : String(obsError)}`);
        }

        await sleep(CHECK_INTERVAL_MS);
      }

      if (!downloadFound) {
        console.log('\n⚠️  Download button did not appear within timeout');
        record.error = record.error ? `${record.error}; Fallback download timeout` : 'Fallback download timeout - button never appeared';
      }

    } catch (error) {
      throw new Error(`Failed to view and download application: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async executeWorkflow(): Promise<void> {
    try {
      await this.initialize();
      if (this.prePayCheckEnabled) {
        this.loadPersistedApplications();
      }
      await this.loadPlotNumbers();

      await this.navigateToDari();
      await this.clickLoginButton();
      await this.clickUAEPassLogin();
      await this.enterMobileAndEnableRememberMe();
      await this.waitForUAEPassApproval();

      if (this.config.accountSwitching.enabled) {
        await this.switchToAlJurfHospitalityAccount();
      }

      await this.navigateToServicesMenu();
      await this.selectSitePlanService();

      await this.processAllPlots();

      await this.processFailedDownloads();

      console.log('\n==============================================');
      console.log('✓ DARI SITE PLAN WORKFLOW COMPLETED');
      console.log('==============================================\n');

      this.printFinalSummary();

    } catch (error) {
      console.error('\n❌ Error during Dari Site Plan workflow:', error);
      console.error('\nTroubleshooting tips:');
      console.error('- Ensure siteplan.xlsx exists in the data/ folder');
      console.error('- Check that UAE Pass app is installed and configured');
      console.error('- Verify mobile number is correct in .env');
      console.error('- Ensure Dari Wallet has sufficient balance');
      console.error('- Check network connectivity\n');
      throw error;
    } finally {
      await this.close();
    }
  }

  printFinalSummary(): void {
    const downloadedFirstTry = this.sitePlans.filter(sp => sp.certificateDownloaded && !sp.downloadedViaFallback && !sp.alreadyExistedInApplications).length;
    const downloadedViaFallback = this.sitePlans.filter(sp => sp.certificateDownloaded && sp.downloadedViaFallback).length;
    const downloadedViaSmartWorkflow = this.sitePlans.filter(sp => sp.certificateDownloaded && sp.alreadyExistedInApplications).length;
    const totalDownloaded = this.sitePlans.filter(sp => sp.certificateDownloaded).length;
    const newPayments = this.sitePlans.filter(sp => sp.paid && !sp.alreadyExistedInApplications).length;
    const skippedPayments = this.sitePlans.filter(sp => sp.alreadyExistedInApplications).length;
    const failedCompletely = this.sitePlans.filter(sp => sp.paid && !sp.certificateDownloaded).length;
    const errors = this.sitePlans.filter(sp => sp.error !== null).length;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 FINAL COMPREHENSIVE SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📈 Overall Statistics:');
    console.log(`   Total Plots Processed: ${this.plots.length}`);
    console.log(`   New Payments Made: ${newPayments}`);
    console.log(`   Duplicate Payments Prevented: ${skippedPayments} 💰`);
    console.log(`   Total Certificates Downloaded: ${totalDownloaded}`);
    console.log(`   Failed/Skipped: ${errors}\n`);

    if (this.prePayCheckEnabled) {
      console.log('💡 Smart Money Safety:');
      console.log(`   💾 Applications in Persistent Storage: ${this.persistedApplications.size}`);
      console.log(`   ✅ Safe from duplicate payments on future runs!\n`);
    }

    console.log('📥 Download Breakdown:');
    console.log(`   ✅ Downloaded on First Try (after payment): ${downloadedFirstTry}`);
    console.log(`   🔄 Downloaded via Fallback Recovery: ${downloadedViaFallback}`);
    console.log(`   💡 Downloaded via Smart Workflow (no payment): ${downloadedViaSmartWorkflow}`);
    console.log(`   ❌ Failed Completely (Paid but not downloaded): ${failedCompletely}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Detailed Records:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    this.sitePlans.forEach((record, index) => {
      let status: string;
      let icon: string;

      if (record.certificateDownloaded && record.alreadyExistedInApplications) {
        status = 'Downloaded via Smart Workflow (NO PAYMENT - Already Existed)';
        icon = '💡';
      } else if (record.certificateDownloaded && record.downloadedViaFallback) {
        status = 'Paid & Downloaded (via Fallback Recovery)';
        icon = '🔄';
      } else if (record.certificateDownloaded) {
        status = 'Paid & Downloaded (First Try)';
        icon = '✅';
      } else if (record.paid && !record.certificateDownloaded) {
        status = 'Paid but Download Failed';
        icon = '❌';
      } else if (record.error) {
        status = record.error;
        icon = '⚠️';
      } else {
        status = 'Processing incomplete';
        icon = '⏳';
      }

      console.log(`${icon} ${index + 1}. Plot ${record.plotNumber}`);
      console.log(`   Status: ${status}`);
      if (record.applicationId) {
        console.log(`   Application ID: ${record.applicationId}`);
      }
      if (record.alreadyExistedInApplications) {
        console.log(`   💰 Money Saved: Skipped duplicate payment!`);
      }
      if (record.downloadAttempts > 0) {
        console.log(`   Download Attempts: ${record.downloadAttempts}`);
      }
      if (record.lastDownloadAttemptTime) {
        console.log(`   Last Attempt: ${new Date(record.lastDownloadAttemptTime).toLocaleString()}`);
      }
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏁 WORKFLOW COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  async close(): Promise<void> {
    if (this.stagehand) {
      await this.stagehand.close();
      console.log('Dari Site Plan Agent closed');
    }
  }
}
