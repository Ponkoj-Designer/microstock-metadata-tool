const puppeteer = require('puppeteer');

(async () => {
  console.log("Starting Puppeteer browser...");
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  
  const requestErrors = [];
  page.on('requestfailed', request => {
    requestErrors.push(`${request.method()} ${request.url()} - ${request.failure().errorText}`);
  });

  const apiResponses = [];
  page.on('response', async response => {
    if (response.url().includes('/api/')) {
        apiResponses.push(`${response.request().method()} ${response.url()} - ${response.status()}`);
    }
  });

  try {
    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    console.log("Page loaded successfully.");
    
    // Check if app.js threw any unhandled errors on load
    if (pageErrors.length > 0) {
        console.log("PAGE ERRORS DETECTED ON LOAD:", pageErrors);
    } else {
        console.log("No page errors on load.");
    }
    
    // Try to click some buttons
    console.log("Attempting to click Login button...");
    await page.click('#nav-btn-login');
    // Puppeteer 22+ uses page.waitForNetworkIdle, fallback to old or just sleep
    await new Promise(r => setTimeout(r, 500));
    
    console.log("Attempting to type in Auth modal...");
    await page.type('#login-email', 'test@example.com');
    await page.type('#login-password', 'password');
    await page.click('#btn-login-submit');
    await new Promise(r => setTimeout(r, 2000));
    
  } catch (err) {
      console.error("Test execution error:", err);
  } finally {
      console.log("\n--- CONSOLE LOGS ---");
      console.log(consoleLogs);
      console.log("\n--- PAGE ERRORS ---");
      console.log(pageErrors);
      console.log("\n--- API RESPONSES ---");
      console.log(apiResponses);
      console.log("\n--- REQUEST ERRORS ---");
      console.log(requestErrors);
      await browser.close();
  }
})();
