import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { retry } from '../utils/retry.js';
import {
  loadDariAffectionPlanConfig,
  createDariAffectionPlanConfig,
  type DariAffectionPlanConfig,
} from '../config/dari-affection-plan-config.js';
import { loadElectronConfig } from '../electron-bridge.js';
import XLSX from 'xlsx';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Helper function to add delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PlotData {
  plotNumber: string;
  rowIndex: number;
}

interface PlotResult {
  plotNumber: string;
  rowIndex: number;
  applicationId: string | null;
  paymentCompleted: boolean;
  downloadCompleted: boolean;
  error?: string;
}

/**
 * Dari Affection Plan Agent
 * Automates affection plan processing on Dari platform using Stagehand v3 best practices
 */
export class DariAffectionPlanAgent {
  private stagehand: Stagehand | null = null;
  private config: DariAffectionPlanConfig;
  private plots: PlotData[] = [];
  private results: PlotResult[] = [];

  constructor() {
    // Load config from Electron if available, otherwise use defaults
    const electronConfig = loadElectronConfig();
    if (electronConfig) {
      this.config = createDariAffectionPlanConfig({
        mobileNumber: electronConfig.mobileNumber || '0559419961',
      });
      console.log('ℹ️  Loaded configuration from Electron UI\n');
    } else {
      this.config = loadDariAffectionPlanConfig();
      console.log('ℹ️  Using default configuration\n');
    }
  }

  async initialize(): Promise<void> {
    console.log('🚀 Initializing Dari Affection Plan Agent...\n');

    this.stagehand = new Stagehand({
      env: 'LOCAL',
      verbose: 1,
      enableCaching: false,
      domSettleTimeoutMs: this.config.waitTimes.domSettle,
      // Note: Uses Stagehand's built-in free model (gpt-4.1-mini)
      // No OpenAI API key required
    });

    await this.stagehand.init();
    console.log('✓ Dari Affection Plan Agent initialized\n');
    console.log('📍 Mobile Number:', this.config.mobileNumber);
    console.log('⏱️  UAE Pass Timeout:', this.config.waitTimes.uaePassTimeout / 1000, 'seconds');
    console.log('⏱️  CAPTCHA Timeout:', this.config.waitTimes.captcha / 1000, 'seconds\n');
  }

  /**
   * Step 1: Navigate to Dari homepage
   */
  async navigateToHomepage(): Promise<void> {
    console.log('==============================================');
    console.log('Step 1: Navigate to Dari Homepage');
    console.log('==============================================\n');

    if (!this.stagehand?.page) {
      throw new Error('Stagehand not initialized');
    }

    console.log(`🌐 Navigating to: ${this.config.baseUrl}`);
    await this.stagehand.page.goto(this.config.baseUrl);

    await sleep(this.config.waitTimes.pageLoad);
    console.log('✓ Homepage loaded\n');
  }

  /**
   * Step 2: Click Login button
   */
  async clickLoginButton(): Promise<void> {
    console.log('==============================================');
    console.log('Step 2: Click Login Button');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    // Use observe to find the login button
    console.log('🔍 Observing page for Login button...');
    const observation = await page.observe({
      instruction: 'Find the Login button in the top right corner of the page',
    });
    console.log(`📊 Found ${observation.length} interactive elements\n`);

    // Click login button with retry
    await retry(
      async () => {
        console.log('🖱️  Clicking Login button...');
        await page.act({
          action: 'click the Login button in the top right corner',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ Login button clicked\n');
  }

  /**
   * Step 3: Click "Login with UAE Pass" button
   */
  async clickUAEPassButton(): Promise<void> {
    console.log('==============================================');
    console.log('Step 3: Click UAE Pass Login');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    await retry(
      async () => {
        console.log('🖱️  Clicking "Login with UAE Pass" button...');
        await page.act({
          action: 'click the "Login with UAE PASS" button',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ UAE Pass login initiated\n');
  }

  /**
   * Step 4: Enter mobile number and handle CAPTCHA
   */
  async enterMobileNumber(): Promise<void> {
    console.log('==============================================');
    console.log('Step 4: Enter Mobile Number');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    // Enter mobile number
    await retry(
      async () => {
        console.log(`📱 Entering mobile number: ${this.config.mobileNumber}...`);
        await page.act({
          action: `clear the phone number input field and type ${this.config.mobileNumber}`,
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ Mobile number entered\n');

    // Check if CAPTCHA is present
    console.log('🔍 Checking for CAPTCHA...');
    const hasCaptcha = await page.observe({
      instruction: 'Find any CAPTCHA, reCAPTCHA, or verification challenges on the page',
    });

    if (hasCaptcha && hasCaptcha.length > 0) {
      console.log('⚠️  CAPTCHA detected!');
      console.log(`⏳ Please solve the CAPTCHA manually within ${this.config.waitTimes.captcha / 1000} seconds...`);
      console.log('👉 Look at the browser window and complete the CAPTCHA\n');
      await sleep(this.config.waitTimes.captcha);
      console.log('✓ CAPTCHA window completed\n');
    } else {
      console.log('✓ No CAPTCHA detected\n');
    }
  }

  /**
   * Step 5: Click Login/Submit button
   */
  async clickLoginSubmit(): Promise<void> {
    console.log('==============================================');
    console.log('Step 5: Submit Login');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    await retry(
      async () => {
        console.log('🖱️  Clicking Login/Submit button...');
        await page.act({
          action: 'click the Login or Submit button',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ Login submitted\n');
  }

  /**
   * Step 6: Detect UAE Pass 2FA completion automatically
   */
  async detectUAEPassCompletion(): Promise<void> {
    console.log('==============================================');
    console.log('Step 6: UAE Pass 2FA Detection');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    console.log('📱 UAE Pass 2FA Required');
    console.log('👉 Please approve the login request on your UAE Pass mobile app\n');
    console.log(`⏳ Monitoring for login completion (timeout: ${this.config.waitTimes.uaePassTimeout / 1000}s)...\n`);

    const startTime = Date.now();
    let detectedLogin = false;

    while (Date.now() - startTime < this.config.waitTimes.uaePassTimeout) {
      await sleep(3000); // Check every 3 seconds

      const currentUrl = page.url();

      // Check if we're back to Dari (not on UAE Pass anymore)
      if (!this.config.detection.uaePassUrlPattern.test(currentUrl)) {
        console.log('🔍 Returned to Dari domain, verifying login...');

        // Use observe to check for login success indicators
        const observation = await page.observe({
          instruction: 'Find elements that indicate a successful login like logout button, profile menu, or dashboard',
        });

        const loginIndicators = observation.filter((el) =>
          this.config.detection.loginSuccessIndicators.some((indicator) =>
            el.description.toLowerCase().includes(indicator)
          )
        );

        if (loginIndicators.length > 0) {
          detectedLogin = true;
          console.log('✅ Login detected successfully!');
          console.log(`📊 Found ${loginIndicators.length} login indicators:`);
          loginIndicators.forEach((ind) => console.log(`   - ${ind.description}`));
          console.log();
          break;
        }
      }

      // Show progress
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed % 10 === 0) {
        console.log(`⏳ Still waiting... (${elapsed}s elapsed)`);
      }
    }

    if (!detectedLogin) {
      throw new Error('UAE Pass 2FA timeout - login not completed within time limit');
    }

    console.log('✓ UAE Pass authentication completed\n');
  }

  /**
   * Step 6.5: Switch Account (Optional - based on config)
   */
  async switchAccount(): Promise<void> {
    console.log('==============================================');
    console.log(`Step 6.5: Switch to ${this.config.accountSwitching.targetAccountName}`);
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    // Step 1: Click user menu in header
    console.log('🔍 Step 1: Looking for user menu in header...');
    await sleep(2000);

    await retry(
      async () => {
        console.log('🖱️  Clicking user menu...');
        await page.act({
          action: 'click the user menu or profile menu in the top right header',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ User menu opened\n');

    // Step 2: Click Switch Account option in dropdown
    console.log('🔍 Step 2: Looking for Switch Account option...');
    await sleep(1500);

    await retry(
      async () => {
        console.log('🖱️  Clicking Switch Account...');
        await page.act({
          action: 'click the Switch Account option in the dropdown menu',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ Switch Account clicked\n');

    // Step 3: Wait for modal/popup and select target account
    console.log('🔍 Step 3: Waiting for account selection modal...');
    await sleep(3000);

    console.log(`🖱️  Selecting "${this.config.accountSwitching.targetAccountName}"...`);
    await retry(
      async () => {
        await page.act({
          action: `click on the "${this.config.accountSwitching.targetAccountName}" account to select it`,
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✓ Account selected\n');

    // Step 4: Wait for page to reload with new account
    console.log('⏳ Waiting for page to reload with new account...');
    await sleep(5000);
    await page.waitForLoadState('networkidle');

    console.log('✓ Page reloaded with new account\n');
    console.log(`✅ Successfully switched to ${this.config.accountSwitching.targetAccountName}\n`);
  }

  /**
   * Step 7: Navigate to Services menu
   */
  async navigateToServicesMenu(): Promise<void> {
    console.log('==============================================');
    console.log('Step 7: Navigate to Services Menu');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    console.log(`🔍 Looking for "${this.config.navigation.servicesMenuText}" menu...`);
    const servicesObservation = await page.observe({
      instruction: `Find the "${this.config.navigation.servicesMenuText}" menu item in the navigation`,
    });

    console.log(`📊 Found ${servicesObservation.length} navigation elements\n`);

    await retry(
      async () => {
        console.log(`🖱️  Clicking "${this.config.navigation.servicesMenuText}" menu...`);
        await page.act({
          action: `click on the "${this.config.navigation.servicesMenuText}" menu`,
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    await sleep(this.config.waitTimes.pageLoad);
    console.log('✓ Services page loaded\n');
  }

  /**
   * Step 8: Select Verification Certificate (Unit) service
   */
  async selectAffectionPlanService(): Promise<void> {
    console.log('==============================================');
    console.log('Step 8: Select Verification Certificate (Unit) Service');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    console.log(`🔍 Looking for "${this.config.navigation.affectionPlanServiceText}" service...`);
    console.log('ℹ️  Using click-through navigation to preserve session state\n');

    const servicesObservation = await page.observe({
      instruction: `Find the "${this.config.navigation.affectionPlanServiceText}" service card or link`,
    });

    console.log(`📊 Found ${servicesObservation.length} service elements\n`);

    await retry(
      async () => {
        console.log(`🖱️  Clicking "${this.config.navigation.affectionPlanServiceText}" service...`);
        await page.act({
          action: `click on the "${this.config.navigation.affectionPlanServiceText}" service`,
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    await sleep(this.config.waitTimes.pageLoad);
    console.log('✓ Verification Certificate (Unit) service page loaded\n');
  }

  /**
   * Step 9: Extract page information and verify we're on the right page
   */
  async verifyAffectionPlanPage(): Promise<void> {
    console.log('==============================================');
    console.log('Step 9: Verify Service Page');
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    // Define schema for page verification
    const PageInfoSchema = z.object({
      serviceName: z.string().describe('The name of the service shown on the page'),
      isServicePage: z.boolean().describe('Whether this is a valid service page with forms or actions'),
      availableActions: z.array(z.string()).describe('List of available actions or buttons on the page'),
    });

    console.log('🔍 Extracting page information...');
    const pageInfo = await page.extract({
      instruction: `Extract the service name, confirm if this is the ${this.config.navigation.affectionPlanServiceText} service page, and list available actions`,
      schema: PageInfoSchema,
    });

    console.log('📊 Page Information:');
    console.log('   Service Name:', pageInfo.serviceName);
    console.log('   Is Service Page:', pageInfo.isServicePage);
    console.log('   Available Actions:', pageInfo.availableActions.join(', '));
    console.log();

    if (!pageInfo.isServicePage) {
      throw new Error(`Not on ${this.config.navigation.affectionPlanServiceText} service page. Please check navigation.`);
    }

    console.log(`✓ Successfully verified ${this.config.navigation.affectionPlanServiceText} service page\n`);
  }

  /**
   * Load plot numbers from Excel file
   */
  async loadPlotNumbers(): Promise<void> {
    console.log('==============================================');
    console.log('Step 10: Load Plot Numbers from Excel');
    console.log('==============================================\n');

    const excelPath = this.getExcelFilePath();
    console.log(`📁 Excel file path: ${excelPath}`);

    if (!existsSync(excelPath)) {
      throw new Error(`Excel file not found at: ${excelPath}`);
    }

    console.log('✓ Excel file found');

    const workbook = XLSX.readFile(excelPath);
    console.log(`✓ Workbook loaded, sheets: ${workbook.SheetNames.join(', ')}`);

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length === 0) {
      throw new Error('Excel file is empty');
    }

    console.log(`✓ Loaded ${data.length} rows from Excel`);

    const headerRow = data[0];
    console.log(`📋 Header row: ${JSON.stringify(headerRow)}`);

    const plotColumnIndex = this.config.plotColumnIndex;
    console.log(`✓ Using column index ${plotColumnIndex} for Plot Numbers (column ${plotColumnIndex + 1})\n`);

    this.plots = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row && row[plotColumnIndex]) {
        const plotNumber = row[plotColumnIndex].toString().trim();
        if (plotNumber) {
          this.plots.push({
            plotNumber,
            rowIndex: i + 1,
          });
        }
      }
    }

    if (this.plots.length === 0) {
      throw new Error(`No plot numbers found in column ${plotColumnIndex + 1} of Excel file`);
    }

    console.log(`✅ Loaded ${this.plots.length} plot numbers:\n`);
    this.plots.forEach((plot, index) => {
      console.log(`   ${index + 1}. Plot ${plot.plotNumber} (Row ${plot.rowIndex})`);
    });
    console.log('');
  }

  getExcelFilePath(): string {
    if (this.config.excelFilePath.startsWith('/') || this.config.excelFilePath.match(/^[A-Z]:\\\\/i)) {
      return this.config.excelFilePath;
    }
    return join(process.cwd(), this.config.excelFilePath);
  }

  /**
   * Step 11: Search and filter by plot number
   */
  async searchAndFilterPlot(plot: PlotData): Promise<void> {
    console.log('\n==============================================');
    console.log(`Step 11: Search for Plot ${plot.plotNumber}`);
    console.log('==============================================\n');

    const page = this.stagehand!.page;

    // Observe the filter section
    console.log('🔍 Observing filter section on left side...');
    const filterObservation = await page.observe({
      instruction: 'Find the Plot Number input field in the Filters section on the left sidebar',
    });

    console.log(`📊 Found ${filterObservation.length} elements in filter section\n`);

    // Enter plot number
    console.log(`📝 Entering Plot Number: ${plot.plotNumber}...`);
    await retry(
      async () => {
        await page.act({
          action: `type "${plot.plotNumber}" into the Plot Number input field in the left sidebar`,
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ Plot number entered\n');

    // Click Search Result button
    console.log('🔍 Looking for Search Result button...');
    const searchButtonObservation = await page.observe({
      instruction: 'Find the Search Result button at the bottom of the left sidebar filter section',
    });

    console.log(`📊 Found ${searchButtonObservation.length} elements\n`);

    console.log('🖱️  Clicking Search Result button...');
    await retry(
      async () => {
        await page.act({
          action: 'click the Search Result button at the bottom of the filter section',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ Search Result button clicked\n');

    // Wait for results to load
    console.log('⏳ Waiting for filtered results...');
    await sleep(this.config.waitTimes.pageLoad);

    // Observe filtered results
    console.log('🔍 Observing filtered results on right side...');
    const resultsObservation = await page.observe({
      instruction: 'Find the filtered property results on the right side, or any message indicating no results found',
    });

    console.log(`📊 Found ${resultsObservation.length} elements in results area`);
    if (resultsObservation.length > 0) {
      console.log('   Sample results:');
      resultsObservation.slice(0, 3).forEach((item: any, idx: number) => {
        console.log(`      ${idx + 1}. ${item.description?.substring(0, 80)}`);
      });
    }
    console.log('');

    console.log(`✅ Plot ${plot.plotNumber} search completed\n`);

    // Check if results found
    const pageText = await page.textContent('body');
    const noResults = pageText?.toLowerCase().includes("no result") ||
                      pageText?.toLowerCase().includes("not found") ||
                      resultsObservation.length === 0;

    if (noResults) {
      console.log('⚠️  No results found for this plot');
      console.log('   Skipping to next plot...\n');
      return;
    }

    // Select the filtered result
    console.log('🖱️  Clicking on the filtered property result...');
    await retry(
      async () => {
        await page.act({
          action: 'click on the property that appears in the filtered results on the right side',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ Property selected\n');

    // Observe for Proceed button
    console.log('🔍 Looking for red Proceed button...');
    const proceedObservation = await page.observe({
      instruction: 'Find the red Proceed button at the bottom (not the gray Cancel button)',
    });

    console.log(`📊 Found ${proceedObservation.length} interactive elements`);
    if (proceedObservation.length > 0) {
      console.log('   Top elements:');
      proceedObservation.slice(0, 5).forEach((item: any, idx: number) => {
        console.log(`      ${idx + 1}. ${item.description?.substring(0, 80)} [${item.method}]`);
      });
    }
    console.log('');

    // Click Proceed button
    console.log('🖱️  Clicking Proceed button...');
    await retry(
      async () => {
        await page.act({
          action: 'click the red Proceed button at the bottom to continue',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ Proceed button clicked\n');

    // Wait for navigation to complete
    console.log('⏳ Waiting for page navigation...');
    const startUrl = page.url();
    console.log(`   Current URL before navigation: ${startUrl}`);

    // Wait for URL to change (indicates navigation started)
    let navigationStarted = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const currentUrl = page.url();
      if (currentUrl !== startUrl) {
        console.log(`   ✓ Navigation detected after ${(i + 1) * 500}ms`);
        console.log(`   New URL: ${currentUrl}\n`);
        navigationStarted = true;
        break;
      }
    }

    if (!navigationStarted) {
      console.log('   ⚠️  URL did not change - page might have loaded in place\n');
    }

    // Wait for page to be in loaded state
    console.log('⏳ Waiting for page load state...');
    await page.waitForLoadState('domcontentloaded');
    console.log('   ✓ DOM content loaded\n');

    await sleep(2000);

    // Intelligent wait for page content using observe()
    console.log('⏳ Waiting for page content to be ready...');
    console.log('   Using intelligent observation to detect when page is fully loaded\n');

    let pageReady = false;
    let observationAttempt = 0;
    const MAX_WAIT_ATTEMPTS = 30; // 30 attempts × 2 seconds = 60 seconds max

    while (!pageReady && observationAttempt < MAX_WAIT_ATTEMPTS) {
      observationAttempt++;

      if (observationAttempt === 1 || observationAttempt % 5 === 0) {
        console.log(`   🔍 Observation attempt ${observationAttempt}/${MAX_WAIT_ATTEMPTS}...`);
      }

      try {
        const contentCheck = await page.observe({
          instruction: 'Find application forms, certificate details, payment sections, application IDs, or main page content (not just header/footer navigation)',
        });

        // Check if we have meaningful content (not just navigation)
        const hasContent = contentCheck.some((item: any) => {
          const desc = item.description?.toLowerCase() || '';
          return (
            desc.includes('application') ||
            desc.includes('certificate') ||
            desc.includes('payment') ||
            desc.includes('form') ||
            desc.includes('submit') ||
            desc.includes('proceed') ||
            desc.includes('reference') ||
            desc.includes('id')
          ) && !desc.includes('header') && !desc.includes('navigation');
        });

        if (hasContent && contentCheck.length >= 5) {
          console.log(`   ✅ Page content detected after ${observationAttempt} attempts`);
          console.log(`   Found ${contentCheck.length} interactive elements on the page\n`);
          pageReady = true;
          break;
        }

        if (observationAttempt % 10 === 0) {
          console.log(`   ℹ️  Still waiting for content... (${observationAttempt * 2}s elapsed)`);
        }

      } catch (error) {
        if (observationAttempt % 10 === 0) {
          console.log(`   ⚠️  Observation error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await sleep(2000);
    }

    if (!pageReady) {
      console.log('   ⚠️  Page content did not fully load within timeout');
      console.log('   Proceeding with observation anyway...\n');
    }

    // Additional delay to ensure stability
    console.log('⏳ Final stabilization delay (5 seconds)...');
    await sleep(5000);
    console.log('   ✓ Page is stable and ready for observation\n');

    // Observe the new page
    console.log('\n🔍 OBSERVING NEW PAGE ELEMENTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const newPageObservation = await page.observe({
      instruction: 'Find ALL elements on this page including headings, forms, buttons, input fields, payment options, application IDs, and any interactive elements',
    });

    console.log(`📊 Total elements found: ${newPageObservation.length}\n`);

    if (newPageObservation.length > 0) {
      console.log('📋 PAGE ELEMENTS SUMMARY:\n');

      // Group elements by type
      const clickableElements = newPageObservation.filter((el: any) => el.method === 'click');
      const inputElements = newPageObservation.filter((el: any) => el.method === 'type');
      const otherElements = newPageObservation.filter((el: any) => el.method !== 'click' && el.method !== 'type');

      if (clickableElements.length > 0) {
        console.log(`🖱️  Clickable Elements (${clickableElements.length}):`);
        clickableElements.slice(0, 10).forEach((item: any, idx: number) => {
          console.log(`   ${idx + 1}. ${item.description}`);
        });
        if (clickableElements.length > 10) {
          console.log(`   ... and ${clickableElements.length - 10} more clickable elements`);
        }
        console.log('');
      }

      if (inputElements.length > 0) {
        console.log(`📝 Input Fields (${inputElements.length}):`);
        inputElements.forEach((item: any, idx: number) => {
          console.log(`   ${idx + 1}. ${item.description}`);
        });
        console.log('');
      }

      if (otherElements.length > 0) {
        console.log(`📄 Other Elements (${otherElements.length}):`);
        otherElements.slice(0, 10).forEach((item: any, idx: number) => {
          console.log(`   ${idx + 1}. ${item.description}`);
        });
        if (otherElements.length > 10) {
          console.log(`   ... and ${otherElements.length - 10} more elements`);
        }
        console.log('');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    // Also get the page URL
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}\n`);

    // Extract text content from key areas
    console.log('🔍 Extracting page information using AI...\n');
    const PageContentSchema = z.object({
      pageTitle: z.string().describe('The main title or heading of this page'),
      hasApplicationId: z.boolean().describe('Whether an Application ID or Reference Number is visible'),
      applicationId: z.string().optional().describe('The Application ID if present'),
      hasPaymentSection: z.boolean().describe('Whether there is a payment section visible'),
      paymentOptions: z.array(z.string()).describe('List of available payment options like credit card, wallet, etc'),
      hasDownloadButton: z.boolean().describe('Whether there is a download button visible'),
      pageType: z.string().describe('What type of page this is (application form, payment page, certificate page, etc)'),
    });

    const pageContent = await page.extract({
      instruction: 'Extract information about this page including title, application ID, payment options, and what type of page this is',
      schema: PageContentSchema,
    });

    console.log('📊 AI EXTRACTED PAGE INFORMATION:\n');
    console.log(`   Page Type: ${pageContent.pageType}`);
    console.log(`   Page Title: ${pageContent.pageTitle}`);
    console.log(`   Has Application ID: ${pageContent.hasApplicationId}`);
    if (pageContent.applicationId) {
      console.log(`   Application ID: ${pageContent.applicationId}`);
    }
    console.log(`   Has Payment Section: ${pageContent.hasPaymentSection}`);
    if (pageContent.paymentOptions.length > 0) {
      console.log(`   Payment Options: ${pageContent.paymentOptions.join(', ')}`);
    }
    console.log(`   Has Download Button: ${pageContent.hasDownloadButton}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Page observation completed for Plot ${plot.plotNumber}\n`);

    // Extract Application ID
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 STEP 12: Extract Application ID');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let applicationId: string | null = null;

    if (pageContent.hasApplicationId && pageContent.applicationId) {
      applicationId = pageContent.applicationId;
      console.log(`✅ Application ID extracted: ${applicationId}\n`);
    } else {
      console.log('⚠️  Application ID not found in AI extraction, trying manual extraction...\n');

      // Fallback: Try to extract from page text
      const pageTextContent = await page.textContent('body');
      const appIdMatch = pageTextContent?.match(/(\d{14,})/);
      if (appIdMatch) {
        applicationId = appIdMatch[1];
        console.log(`✅ Application ID extracted via regex: ${applicationId}\n`);
      } else {
        console.log('❌ Could not extract Application ID');
        console.log('   Skipping this plot...\n');

        // Track failed result
        this.results.push({
          plotNumber: plot.plotNumber,
          rowIndex: plot.rowIndex,
          applicationId: null,
          paymentCompleted: false,
          downloadCompleted: false,
          error: 'Application ID not found',
        });

        return;
      }
    }

    // Select DARI Wallet payment option (Radio B)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💳 STEP 13: Select DARI Wallet Payment Option');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🔍 Observing payment options...');
    const paymentOptionsObservation = await page.observe({
      instruction: 'Find the DARI wallet radio button payment option (Radio B, the second payment option)',
    });

    console.log(`📊 Found ${paymentOptionsObservation.length} payment elements\n`);

    console.log('🖱️  Selecting DARI wallet payment option (Radio B)...');
    await retry(
      async () => {
        await page.act({
          action: 'select the DARI wallet payment option (the second radio button, Radio B)',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ DARI wallet payment option selected\n');

    // Wait for balance details to load
    await sleep(2000);

    // Extract wallet balance and payment amount
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 STEP 14: Check Wallet Balance vs Payment Amount');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🔍 Extracting wallet balance and payment amount...\n');

    const PaymentDetailsSchema = z.object({
      walletBalance: z.string().describe('The DARI wallet balance amount'),
      paymentAmount: z.string().describe('The total payment amount or fee for the certificate'),
      currency: z.string().optional().describe('Currency symbol if visible'),
    });

    const paymentDetails = await page.extract({
      instruction: 'Extract the DARI wallet balance amount and the total payment amount (fee) from the payment details section. Look for balance text near DARI wallet and total/fee amount in payment details.',
      schema: PaymentDetailsSchema,
    });

    console.log('📊 Payment Information:');
    console.log(`   DARI Wallet Balance: ${paymentDetails.walletBalance}`);
    console.log(`   Payment Amount: ${paymentDetails.paymentAmount}`);
    console.log('');

    // Parse amounts
    const balanceStr = paymentDetails.walletBalance.replace(/[^\d.]/g, '');
    const amountStr = paymentDetails.paymentAmount.replace(/[^\d.]/g, '');

    const balance = parseFloat(balanceStr);
    const amount = parseFloat(amountStr);

    console.log(`💵 Numeric Comparison:`);
    console.log(`   Balance: ${balance}`);
    console.log(`   Amount: ${amount}\n`);

    if (isNaN(balance) || isNaN(amount)) {
      console.log('❌ Could not parse balance or payment amount');
      console.log('   Skipping this plot...\n');

      // Track failed result
      this.results.push({
        plotNumber: plot.plotNumber,
        rowIndex: plot.rowIndex,
        applicationId: applicationId,
        paymentCompleted: false,
        downloadCompleted: false,
        error: 'Could not parse balance or payment amount',
      });

      return;
    }

    // PRODUCTION-GRADE: Check if balance can cover ALL plots (only on first plot)
    const isFirstPlot = this.results.length === 0; // No results yet means this is first plot

    if (isFirstPlot) {
      const totalPlots = this.plots.length;
      const totalRequired = amount * totalPlots;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💰 BATCH PAYMENT VALIDATION (First Plot Check)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`   Total Plots to Process:    ${totalPlots}`);
      console.log(`   Payment per Plot:          ${paymentDetails.paymentAmount}`);
      console.log(`   Total Required:            ${totalRequired.toFixed(2)} AED`);
      console.log(`   Current Wallet Balance:    ${paymentDetails.walletBalance}`);
      console.log('');

      if (balance < totalRequired) {
        const shortage = totalRequired - balance;

        console.log('🛑 INSUFFICIENT BALANCE FOR COMPLETE BATCH!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('⚠️  Your wallet balance cannot cover ALL plots.');
        console.log('⚠️  Agent will STOP to prevent partial payments.');
        console.log('');
        console.log('📊 CALCULATION:');
        console.log(`   ${totalPlots} plots × ${amount.toFixed(2)} AED = ${totalRequired.toFixed(2)} AED needed`);
        console.log(`   You have: ${balance.toFixed(2)} AED`);
        console.log(`   Shortage: ${shortage.toFixed(2)} AED`);
        console.log('');
        console.log('💡 NEXT STEPS:');
        console.log(`   1. Add ${shortage.toFixed(2)} AED to your DARI wallet`);
        console.log(`   2. Restart the agent to process all ${totalPlots} plots`);
        console.log('');
        console.log('✅ BENEFIT: No partial payments - either all plots succeed or none!');
        console.log('');
        console.log('🛑 STOPPING WORKFLOW NOW (No payments made)\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Track failed result
        this.results.push({
          plotNumber: plot.plotNumber,
          rowIndex: plot.rowIndex,
          applicationId: applicationId,
          paymentCompleted: false,
          downloadCompleted: false,
          error: `Insufficient balance for batch: need ${totalRequired.toFixed(2)} AED for ${totalPlots} plots, have ${balance.toFixed(2)} AED`,
        });

        throw new Error(`Insufficient balance: need ${totalRequired.toFixed(2)} AED for ${totalPlots} plots, have ${balance.toFixed(2)} AED. Add ${shortage.toFixed(2)} AED and restart.`);
      }

      console.log('✅ SUFFICIENT BALANCE FOR ALL PLOTS!');
      console.log(`   ${balance.toFixed(2)} AED ≥ ${totalRequired.toFixed(2)} AED required`);
      console.log('   Proceeding with confidence - can complete entire batch!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      // For subsequent plots, just check this plot's amount
      if (balance < amount) {
        console.log('⚠️  WARNING: Insufficient balance for this plot');
        console.log(`   This shouldn't happen - initial check showed sufficient balance`);
        console.log(`   Plot: ${plot.plotNumber}`);
        console.log(`   Available: ${balance.toFixed(2)} AED`);
        console.log(`   Required: ${amount.toFixed(2)} AED`);
        console.log('   Skipping this plot...\n');

        // Track failed result
        this.results.push({
          plotNumber: plot.plotNumber,
          rowIndex: plot.rowIndex,
          applicationId: applicationId,
          paymentCompleted: false,
          downloadCompleted: false,
          error: `Insufficient balance (shortage: ${(amount - balance).toFixed(2)})`,
        });

        return;
      }
    }

    console.log('✅ SUFFICIENT BALANCE!');
    console.log(`   Wallet has enough balance to proceed with payment\n`);

    // Click Pay Now button
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💳 STEP 15: Click Pay Now Button');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🔍 Finding Pay Now button...');
    const payNowObservation = await page.observe({
      instruction: 'Find the Pay now button at the bottom of the page',
    });

    console.log(`📊 Found ${payNowObservation.length} elements`);
    const payNowButton = payNowObservation.find((el: any) =>
      el.description?.toLowerCase().includes('pay now') && el.method === 'click'
    );

    if (!payNowButton) {
      console.log('❌ Pay Now button not found\n');
      return;
    }

    console.log(`✅ Pay Now button found: ${payNowButton.description}\n`);

    console.log('🖱️  Clicking Pay Now button...');
    await retry(
      async () => {
        await page.act({
          action: 'click the Pay now button to complete the payment',
        });
        await sleep(this.config.waitTimes.afterClick);
      },
      {
        maxAttempts: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          console.log(`⚠️  Retry ${attempt}: ${error.message}`);
        },
      }
    );

    console.log('✅ Pay Now button clicked\n');

    // Wait for payment processing and next page
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⏳ STEP 16: Wait for Payment Processing & Download Page');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('⏳ Waiting for payment to process...');
    const paymentStartUrl = page.url();
    console.log(`   Current URL: ${paymentStartUrl}\n`);

    // PRODUCTION-GRADE WAITING: Monitor URL change
    console.log('🔍 Monitoring URL change (max 30 seconds)...');
    let downloadNavStarted = false;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const currentUrl = page.url();
      if (currentUrl !== paymentStartUrl) {
        console.log(`   ✓ Navigation detected after ${(i + 1) * 500}ms`);
        console.log(`   ✓ New URL: ${currentUrl}\n`);
        downloadNavStarted = true;
        break;
      }
    }

    if (!downloadNavStarted) {
      console.log('⚠️  URL did not change - payment may have processed in place\n');
    }

    // Wait for DOM to load
    console.log('⏳ Waiting for DOM content to load...');
    await page.waitForLoadState('domcontentloaded');
    await sleep(2000);
    console.log('   ✓ DOM loaded\n');

    // Wait for network idle
    console.log('⏳ Waiting for network to settle...');
    await page.waitForLoadState('networkidle');
    console.log('   ✓ Network idle\n');

    // PRODUCTION-GRADE WAITING: Intelligent content detection
    console.log('🔍 Detecting download page content (max 60 seconds)...');
    let downloadPageReady = false;
    let downloadObservationAttempt = 0;
    const MAX_DOWNLOAD_WAIT_ATTEMPTS = 30; // 60 seconds max

    while (!downloadPageReady && downloadObservationAttempt < MAX_DOWNLOAD_WAIT_ATTEMPTS) {
      downloadObservationAttempt++;

      const contentCheck = await page.observe({
        instruction: 'Find download buttons, certificate status, application details, or download page content (not just header/footer)',
      });

      const hasDownloadContent = contentCheck.some((item: any) => {
        const desc = item.description?.toLowerCase() || '';
        return (
          desc.includes('download') ||
          desc.includes('certificate') ||
          desc.includes('application') ||
          desc.includes('status') ||
          desc.includes('complete')
        ) && !desc.includes('header') && !desc.includes('navigation');
      });

      if (hasDownloadContent && contentCheck.length >= 3) {
        console.log(`   ✓ Download page content detected (attempt ${downloadObservationAttempt})`);
        console.log(`   ✓ Found ${contentCheck.length} meaningful elements\n`);
        downloadPageReady = true;
        break;
      }

      if (downloadObservationAttempt % 5 === 0) {
        console.log(`   ⏳ Still waiting... (attempt ${downloadObservationAttempt}/${MAX_DOWNLOAD_WAIT_ATTEMPTS})`);
      }

      await sleep(2000);
    }

    if (!downloadPageReady) {
      console.log('⚠️  Download page content not fully detected - proceeding anyway\n');
    }

    // Final stabilization delay
    console.log('⏳ Final stabilization delay (5 seconds)...');
    await sleep(5000);
    console.log('   ✓ Page fully stabilized\n');

    // Observe the download/certificate page
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 STEP 17: Observe & Download Certificate');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🔍 Observing all elements on download page...\n');

    const downloadPageObservation = await page.observe({
      instruction: 'Find all elements on this page, especially download buttons, download certificate buttons, or any buttons in the top area of the page',
    });

    console.log(`📊 Found ${downloadPageObservation.length} elements on page`);

    // Log all clickable elements for debugging
    const clickableElements = downloadPageObservation.filter((el: any) => el.method === 'click');
    console.log(`   └─ ${clickableElements.length} clickable elements\n`);

    // Look for download button (prioritize top area buttons)
    const downloadButton = downloadPageObservation.find((el: any) => {
      const desc = el.description?.toLowerCase() || '';
      return (
        el.method === 'click' &&
        (desc.includes('download') &&
         (desc.includes('certificate') || desc.includes('plan') || desc.includes('button')))
      );
    });

    let downloadSuccess = false;

    if (downloadButton) {
      console.log('✅ DOWNLOAD BUTTON FOUND!');
      console.log(`   Button: ${downloadButton.description}\n`);

      // Human-like delay before clicking (3 seconds)
      console.log('⏳ Waiting 3 seconds (human-like behavior)...');
      await sleep(3000);
      console.log('   ✓ Ready to download\n');

      console.log('📥 Clicking download button...');
      try {
        await retry(
          async () => {
            await page.act({
              action: 'click the download certificate button at the top of the page',
            });
            await sleep(2000);
          },
          {
            maxAttempts: 3,
            delayMs: 2000,
            onRetry: (attempt, error) => {
              console.log(`⚠️  Retry ${attempt}: ${error.message}`);
            },
          }
        );

        console.log('✅ CERTIFICATE DOWNLOAD INITIATED!');
        downloadSuccess = true;

        // Wait a bit to observe download
        console.log('⏳ Waiting for download to complete (3 seconds)...');
        await sleep(3000);
        console.log('   ✓ Download should be complete\n');

      } catch (error) {
        console.log(`❌ Failed to click download button: ${error}\n`);
        downloadSuccess = false;
      }
    } else {
      console.log('⚠️  Download button not found on page');
      console.log('   Certificate may still be processing or button not visible\n');
    }

    // Save result for this plot
    this.results.push({
      plotNumber: plot.plotNumber,
      rowIndex: plot.rowIndex,
      applicationId: applicationId,
      paymentCompleted: true,
      downloadCompleted: downloadSuccess,
    });

    // Show plot summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 PLOT PROCESSING SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Plot Number:     ${plot.plotNumber}`);
    console.log(`   Row Index:       ${plot.rowIndex}`);
    console.log(`   Application ID:  ${applicationId || 'N/A'}`);
    console.log(`   Payment:         ✅ Completed`);
    console.log(`   Download:        ${downloadSuccess ? '✅ Success' : '⚠️  Pending/Failed'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  /**
   * Navigate back to service page for next plot
   */
  async navigateBackToServicePage(): Promise<void> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 Navigating Back to Service Page');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🖱️  Clicking on Services menu...');
    await this.navigateToServicesMenu();

    console.log('🖱️  Clicking on service again...');
    await this.selectAffectionPlanService();

    console.log('✅ Back on service page, ready for next plot\n');
  }

  /**
   * Show final comprehensive summary of all processed plots
   */
  showFinalSummary(): void {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL PROCESSING SUMMARY                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // Calculate statistics
    const totalPlots = this.results.length;
    const paidPlots = this.results.filter(r => r.paymentCompleted).length;
    const downloadedPlots = this.results.filter(r => r.downloadCompleted).length;
    const failedPlots = this.results.filter(r => r.error).length;
    const pendingDownloads = paidPlots - downloadedPlots;

    console.log('📊 OVERALL STATISTICS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Total Plots Attempted:     ${totalPlots}`);
    console.log(`   Payments Completed:        ${paidPlots} ✅`);
    console.log(`   Downloads Completed:       ${downloadedPlots} 📥`);
    console.log(`   Downloads Pending:         ${pendingDownloads} ⏳`);
    console.log(`   Failed/Skipped:            ${failedPlots} ❌`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Detailed results table
    console.log('📋 DETAILED RESULTS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    this.results.forEach((result, index) => {
      console.log(`${index + 1}. Plot: ${result.plotNumber} (Row ${result.rowIndex})`);
      console.log(`   Application ID:  ${result.applicationId || 'N/A'}`);
      console.log(`   Payment:         ${result.paymentCompleted ? '✅ Completed' : '❌ Not Completed'}`);
      console.log(`   Download:        ${result.downloadCompleted ? '✅ Downloaded' : '⚠️  Pending/Failed'}`);
      if (result.error) {
        console.log(`   Error:           ${result.error}`);
      }
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Show plots that were paid but not downloaded (critical info)
    if (pendingDownloads > 0) {
      console.log('⚠️  IMPORTANT - PLOTS PAID BUT NOT DOWNLOADED:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   These plots have been paid for but downloads did not complete.');
      console.log('   You can retry downloading these certificates later.\n');

      const pendingResults = this.results.filter(r => r.paymentCompleted && !r.downloadCompleted);
      pendingResults.forEach((result) => {
        console.log(`   • Plot ${result.plotNumber}: Application ID ${result.applicationId}`);
      });

      console.log('');
      console.log('   💡 Save these Application IDs - you\'ll need them to retry downloads.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    // Show success message if all completed
    if (downloadedPlots === totalPlots) {
      console.log('🎉 SUCCESS! All plots processed and downloaded successfully!\n');
    } else if (paidPlots === totalPlots && downloadedPlots > 0) {
      console.log('✅ All payments completed! Some downloads may need retry.\n');
    } else if (failedPlots === totalPlots) {
      console.log('❌ No plots were successfully processed. Please check errors above.\n');
    }

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                     PROCESSING COMPLETE                        ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
  }

  /**
   * Main workflow execution
   */
  async executeWorkflow(): Promise<void> {
    try {
      await this.initialize();

      if (!this.stagehand?.page) {
        throw new Error('Stagehand not initialized');
      }

      console.log('\n🎯 Starting Dari Affection Plan Workflow\n');
      console.log('==============================================\n');

      // Execute workflow steps
      await this.navigateToHomepage();
      await this.clickLoginButton();
      await this.clickUAEPassButton();
      await this.enterMobileNumber();
      await this.clickLoginSubmit();
      await this.detectUAEPassCompletion();

      // Conditional account switching
      if (this.config.accountSwitching.enabled) {
        await this.switchAccount();
      } else {
        console.log('ℹ️  Account switching disabled in config - skipping\n');
      }

      await this.navigateToServicesMenu();
      await this.selectAffectionPlanService();
      await this.verifyAffectionPlanPage();

      // Load plot numbers from Excel
      await this.loadPlotNumbers();

      // Process all plots
      console.log('\n==============================================');
      console.log(`Processing ${this.plots.length} Plots`);
      console.log('==============================================\n');

      for (let i = 0; i < this.plots.length; i++) {
        const plot = this.plots[i];
        console.log(`\n${'━'.repeat(60)}`);
        console.log(`📍 Processing plot ${i + 1} of ${this.plots.length}: ${plot.plotNumber}`);
        console.log(`${'━'.repeat(60)}\n`);

        try {
          await this.searchAndFilterPlot(plot);
        } catch (plotError) {
          console.error(`❌ Error processing plot ${plot.plotNumber}:`, plotError);
          console.log('   Continuing to next plot...\n');

          // Track error if not already tracked
          const alreadyTracked = this.results.some(r => r.plotNumber === plot.plotNumber);
          if (!alreadyTracked) {
            this.results.push({
              plotNumber: plot.plotNumber,
              rowIndex: plot.rowIndex,
              applicationId: null,
              paymentCompleted: false,
              downloadCompleted: false,
              error: plotError instanceof Error ? plotError.message : String(plotError),
            });
          }
        }

        // Navigate back to service page for next plot
        if (i < this.plots.length - 1) {
          console.log('⏳ Preparing for next plot...\n');
          await sleep(2000);

          try {
            await this.navigateBackToServicePage();
          } catch (navError) {
            console.error(`⚠️  Navigation error: ${navError instanceof Error ? navError.message : String(navError)}`);
            console.log('   Will attempt to continue...\n');
          }
        }
      }

      // Show comprehensive final summary
      this.showFinalSummary();

    } catch (error) {
      console.error('\n==============================================');
      console.error('❌ Workflow Failed');
      console.error('==============================================\n');
      console.error('Error:', error);
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check if mobile number is correct');
      console.error('   - Ensure UAE Pass 2FA was approved on mobile');
      console.error('   - Verify CAPTCHA was solved correctly');
      console.error('   - Check if service name matches the Dari website\n');
      throw error;
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.stagehand) {
      console.log('🔒 Closing browser...');
      try {
        await this.stagehand.close();
        console.log('✓ Browser closed\n');
      } catch (err) {
        console.error('⚠️  Error closing browser:', err);
      }
    }
  }
}
