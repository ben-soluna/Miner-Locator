const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');

function buildDriver() {
  const browser = String(process.env.UI_BROWSER || 'chrome').trim().toLowerCase();

  if (browser === 'firefox') {
    const options = new firefox.Options().addArguments('-headless');
    const firefoxBinary = String(process.env.FIREFOX_BINARY || '').trim();
    if (firefoxBinary) {
      options.setBinary(firefoxBinary);
    }

    return new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  }

  const options = new chrome.Options().addArguments('--headless=new', '--window-size=1440,900', '--disable-gpu');
  if (process.platform === 'linux') {
    options.addArguments('--no-sandbox', '--disable-dev-shm-usage');
  }

  return new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

async function run() {
  const driver = await buildDriver();
  const steps = [];
  try {
    await driver.get('http://127.0.0.1:3000');
    await driver.wait(until.elementLocated(By.id('dashboardView')), 10000);
    steps.push('Loaded dashboard');

    await driver.findElement(By.css('[data-action="select-view"][data-view-id="savedRangesView"]')).click();
    await driver.wait(until.elementLocated(By.id('savedRangesView')), 5000);
    steps.push('Opened IP Ranges view');

    const directRange = await driver.findElement(By.id('directRangeInput'));
    await directRange.clear();
    await directRange.sendKeys('10.10.1.1-10.10.1.4');
    await driver.sleep(300);
    await driver.findElement(By.css('[data-action="save-range-builder"]')).click();
    steps.push('Attempted Save in range builder (expected title validation)');

    await driver.findElement(By.css('[data-action="select-view"][data-view-id="settingsView"]')).click();
    const conc = await driver.findElement(By.id('scanConcurrencyInput'));
    await conc.sendKeys(Key.CONTROL, 'a');
    await conc.sendKeys('24');
    await driver.sleep(250);
    await driver.findElement(By.css('[data-action="reset-scan-concurrency"]')).click();
    steps.push('Adjusted + reset scan concurrency');

    await driver.findElement(By.css('[data-action="select-view"][data-view-id="dashboardView"]')).click();
    await driver.findElement(By.css('[data-action="open-modal"][data-view-id="dashboardView"]')).click();
    await driver.wait(until.elementLocated(By.id('colModal')), 5000);
    await driver.findElement(By.css('#colModal [data-action="close-modal"]')).click();
    steps.push('Opened and closed Edit Columns modal');

    const rangeInput = await driver.findElement(By.id('rangeInput'));
    await rangeInput.clear();
    await rangeInput.sendKeys('10.10.1.1');
    await driver.sleep(250);

    const editBtn = await driver.findElement(By.id('editModeToggleBtn'));
    await editBtn.click();
    await driver.sleep(200);
    await editBtn.click();
    steps.push('Toggled Edit Mode on/off');

    const statusText = await driver.findElement(By.id('status')).getText();
    const hintText = await driver.findElement(By.id('scanConcurrencyHint')).getText();

    console.log('CLICKTHROUGH_OK');
    for (const s of steps) console.log('- ' + s);
    console.log('Status text:', statusText);
    console.log('Concurrency hint:', hintText);
  } finally {
    await driver.quit();
  }
}

run().catch((err) => {
  console.error('CLICKTHROUGH_FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
