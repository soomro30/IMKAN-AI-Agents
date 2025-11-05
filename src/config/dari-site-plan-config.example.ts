import { DariSitePlanConfig } from './dari-site-plan-config.js';

/**
 * Example configuration for Dari Site Plan Agent
 *
 * Copy this file to customize the agent behavior:
 * 1. Copy the configuration below
 * 2. Modify values in dari-site-plan-config.ts
 * 3. Run the agent: npm run dev:dari-site-plan
 */

export const exampleConfig: DariSitePlanConfig = {
  // Base URL of the Dari platform
  baseUrl: 'https://www.dari.ae/en/',

  // Path to Excel file containing plot numbers (relative to project root)
  excelFilePath: 'data/siteplan.xlsx',

  // Column index for plot numbers (0-based, so 2 = 3rd column)
  plotColumnIndex: 2,

  // Navigation settings - update these if UI text changes
  navigation: {
    servicesMenuText: 'Services',           // Text of Services menu item
    sitePlanServiceText: 'Site Plan',       // Text of Site Plan service
    sitePlanServiceUrl: 'https://www.dari.ae/en/app/services/siteplan',  // Optional direct URL
  },

  // Account switching settings
  accountSwitching: {
    enabled: true,                          // Set to false to skip account switching
    targetAccountName: 'Al Jurf Hospitality Service',  // Name of account to switch to
  },

  // Page element descriptions for AI navigation
  pageElements: {
    loginButton: 'Login button in the top right corner',
    uaePassLoginButton: 'Login with UAE Pass',
    servicesMenu: 'Services menu in the top navigation bar',
    sitePlanService: 'Site Plan service',
    plotNumberField: 'Plot Number input field on the left side filter menu',
    showResultsButton: 'Show Results button',
    proceedButton: 'Proceed button',
    dariWalletRadioButton: 'DARI wallet radio button',
    payNowButton: 'red Pay now button at the bottom',
  },

  // Payment configuration
  payment: {
    enabled: false,  // ⚠️ IMPORTANT: Set to true to enable actual payments

    // Regex patterns to extract amounts from page
    walletBalancePattern: /Balance\s*:?\s*ß\s*(\d+(?:\.\d+)?)/i,
    totalAmountPattern: /Total\s+to\s+be\s+paid\s*ß\s*(\d+(?:\.\d+)?)/i,
  },

  // Timing configuration (in milliseconds)
  waitTimes: {
    pageLoad: 3000,        // Wait after page load
    afterClick: 2000,      // Wait after clicking elements
    captcha: 20000,        // Time to solve captcha manually
    uaePassTimeout: 180000, // Max time to wait for UAE Pass (3 minutes)
  },
};

/**
 * Usage Examples:
 *
 * 1. Change Site Plan service name:
 *    navigation.sitePlanServiceText = 'New Service Name'
 *
 * 2. Use different account:
 *    accountSwitching.targetAccountName = 'Different Account'
 *
 * 3. Disable account switching:
 *    accountSwitching.enabled = false
 *
 * 4. Enable payments:
 *    payment.enabled = true  // ⚠️ Use with caution!
 *
 * 5. Use different Excel column:
 *    plotColumnIndex = 0  // First column (A)
 *    plotColumnIndex = 1  // Second column (B)
 *    plotColumnIndex = 2  // Third column (C)
 */
