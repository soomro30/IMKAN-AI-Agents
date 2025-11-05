export interface DariSitePlanConfig {
  baseUrl: string;
  excelFilePath: string;
  plotColumnIndex: number;

  navigation: {
    servicesMenuText: string;
    sitePlanServiceText: string;
    sitePlanServiceUrl?: string;
  };

  accountSwitching: {
    enabled: boolean;
    targetAccountName: string;
  };

  pageElements: {
    loginButton: string;
    uaePassLoginButton: string;
    servicesMenu: string;
    sitePlanService: string;
    plotNumberField: string;
    showResultsButton: string;
    proceedButton: string;
    dariWalletRadioButton: string;
    payNowButton: string;
  };

  payment: {
    enabled: boolean;
    walletBalancePattern: RegExp;
    totalAmountPattern: RegExp;
  };

  waitTimes: {
    pageLoad: number;
    afterClick: number;
    captcha: number;
    uaePassTimeout: number;
  };
}

export const defaultDariSitePlanConfig: DariSitePlanConfig = {
  baseUrl: 'https://www.dari.ae/en/',
  excelFilePath: 'data/siteplan.xlsx',
  plotColumnIndex: 2,

  navigation: {
    servicesMenuText: 'Services',
    sitePlanServiceText: 'Verification Certificate (Unit)',
    sitePlanServiceUrl: 'https://www.dari.ae/en/app/services/select-certificates-property',
  },

  accountSwitching: {
    enabled: false,
    targetAccountName: 'Al Jurf Hospitality Service',
  },

  pageElements: {
    loginButton: 'Login button in the top right corner',
    uaePassLoginButton: 'Login with UAE Pass',
    servicesMenu: 'Services menu in the top navigation bar',
    sitePlanService: 'Site Plan',
    plotNumberField: 'Plot Number input field on the left side filter menu',
    showResultsButton: 'Show Results button',
    proceedButton: 'Proceed button',
    dariWalletRadioButton: 'DARI wallet radio button',
    payNowButton: 'red Pay now button at the bottom',
  },

  payment: {
    enabled: false,
    walletBalancePattern: /Balance\s*:?\s*ß\s*(\d+(?:\.\d+)?)/i,
    totalAmountPattern: /Total\s+to\s+be\s+paid\s*ß\s*(\d+(?:\.\d+)?)/i,
  },

  waitTimes: {
    pageLoad: 3000,
    afterClick: 2000,
    captcha: 10000,
    uaePassTimeout: 180000,
  },
};

export function loadDariSitePlanConfig(): DariSitePlanConfig {
  return defaultDariSitePlanConfig;
}

export function createDariSitePlanConfig(overrides: Partial<DariSitePlanConfig>): DariSitePlanConfig {
  return {
    ...defaultDariSitePlanConfig,
    ...overrides,
    navigation: {
      ...defaultDariSitePlanConfig.navigation,
      ...(overrides.navigation || {}),
    },
    accountSwitching: {
      ...defaultDariSitePlanConfig.accountSwitching,
      ...(overrides.accountSwitching || {}),
    },
    pageElements: {
      ...defaultDariSitePlanConfig.pageElements,
      ...(overrides.pageElements || {}),
    },
    payment: {
      ...defaultDariSitePlanConfig.payment,
      ...(overrides.payment || {}),
    },
    waitTimes: {
      ...defaultDariSitePlanConfig.waitTimes,
      ...(overrides.waitTimes || {}),
    },
  };
}
