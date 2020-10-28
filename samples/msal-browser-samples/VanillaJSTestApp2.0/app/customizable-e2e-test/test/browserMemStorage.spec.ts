import "mocha";
import puppeteer from "puppeteer";
import { expect } from "chai";
import { Screenshot, createFolder, setupCredentials } from "../../../../../e2eTestUtils/TestUtils";
import { BrowserCacheUtils } from "../../../../../e2eTestUtils/BrowserCacheTestUtils";
import { LabApiQueryParams } from "../../../../../e2eTestUtils/LabApiQueryParams";
import { AzureEnvironments, AppTypes } from "../../../../../e2eTestUtils/Constants";
import { LabClient } from "../../../../../e2eTestUtils/LabClient";
import { msalConfig as memStorageConfig, request as memStorageTokenRequest } from "../authConfigs/memStorageAuthConfig.json";
import { clickLoginPopup, clickLoginRedirect, enterCredentials, waitForReturnToApp } from "./testUtils";
import fs from "fs";

const SCREENSHOT_BASE_FOLDER_NAME = `${__dirname}/screenshots`;
const SAMPLE_HOME_URL = "http://localhost:30662/";

async function verifyTokenStore(BrowserCache: BrowserCacheUtils, scopes: string[]): Promise<void> {
    const tokenStore = await BrowserCache.getTokens();
    expect(tokenStore.idTokens).to.be.length(0);
    expect(tokenStore.accessTokens).to.be.length(0);
    expect(tokenStore.refreshTokens).to.be.length(0);
    const storage = await BrowserCache.getWindowStorage();
    expect(Object.keys(storage).length).to.be.eq(0);
}

describe("Browser tests", function () {
    this.timeout(0);
    this.retries(1);

    let browser: puppeteer.Browser;
    before(async () => {
        createFolder(SCREENSHOT_BASE_FOLDER_NAME);
        browser = await puppeteer.launch({
            headless: true,
            ignoreDefaultArgs: ["--no-sandbox", "–disable-setuid-sandbox"]
        });
    });

    let context: puppeteer.BrowserContext;
    let page: puppeteer.Page;
    let BrowserCache: BrowserCacheUtils;

    after(async () => {
        await context.close();
        await browser.close();
    });

    describe("In Memory Storage Tests", async () => {
        let username = "";
        let accountPwd = "";
        before(async () => {
            const labApiParams: LabApiQueryParams = {
                azureEnvironment: AzureEnvironments.PPE,
                appType: AppTypes.CLOUD
            };
    
            const labClient = new LabClient();
            const envResponse = await labClient.getVarsByCloudEnvironment(labApiParams);

            [username, accountPwd] = await setupCredentials(envResponse[0], labClient);

            fs.writeFileSync("./app/customizable-e2e-test/testConfig.json", JSON.stringify({msalConfig: memStorageConfig, request: memStorageTokenRequest}));
        });

        describe("login Tests", () => {
            beforeEach(async () => {
                context = await browser.createIncognitoBrowserContext();
                page = await context.newPage();
                BrowserCache = new BrowserCacheUtils(page, memStorageConfig.cache.cacheLocation);
                await page.goto(SAMPLE_HOME_URL);
            });
        
            afterEach(async () => {
                await page.evaluate(() =>  Object.assign({}, window.sessionStorage.clear()));
                await page.evaluate(() =>  Object.assign({}, window.localStorage.clear()));
                await page.close();
            });
    
            it("Performs loginRedirect", async () => {
                const testName = "redirectBaseCase";
                const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

                await clickLoginRedirect(screenshot, page);
                await enterCredentials(page, screenshot, username, accountPwd);
                await waitForReturnToApp(screenshot, page);
                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });
            
            it("Performs loginPopup", async () => {
                const testName = "popupBaseCase";
                const screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);

                const [popupPage, popupWindowClosed] = await clickLoginPopup(screenshot, page);
                await enterCredentials(popupPage, screenshot, username, accountPwd);
                await waitForReturnToApp(screenshot, page, popupPage, popupWindowClosed);

                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });
        });

        describe("acquireToken Tests", () => {
            let testName: string;
            let screenshot: Screenshot;
            
            before(async () => {
                context = await browser.createIncognitoBrowserContext();
                page = await context.newPage();
                BrowserCache = new BrowserCacheUtils(page, memStorageConfig.cache.cacheLocation);
                await page.goto(SAMPLE_HOME_URL);

                testName = "acquireTokenBaseCase";
                screenshot = new Screenshot(`${SCREENSHOT_BASE_FOLDER_NAME}/${testName}`);
                const [popupPage, popupWindowClosed] = await clickLoginPopup(screenshot, page);
                await enterCredentials(popupPage, screenshot, username, accountPwd);
                await waitForReturnToApp(screenshot, page, popupPage, popupWindowClosed);
            });

            beforeEach(async () => {
                await page.reload();
                await page.waitForSelector("#WelcomeMessage");
            });
        
            after(async () => {
                await page.evaluate(() =>  Object.assign({}, window.sessionStorage.clear()));
                await page.evaluate(() =>  Object.assign({}, window.localStorage.clear()));
                await page.close();
            });

            it("acquireTokenRedirect", async () => {
                await page.waitForSelector("#acquireTokenRedirect");
                
                // Remove access_tokens from cache so we can verify acquisition
                const tokenStore = await BrowserCache.getTokens();
                await BrowserCache.removeTokens(tokenStore.refreshTokens);
                await BrowserCache.removeTokens(tokenStore.accessTokens);
                await page.click("#acquireTokenRedirect");
                await page.waitForSelector("#scopes-acquired");
                await screenshot.takeScreenshot(page, "acquireTokenRedirectGotTokens");

                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });

            it("acquireTokenPopup", async () => {
                await page.waitForSelector("#acquireTokenPopup");

                // Remove access_tokens from cache so we can verify acquisition
                const tokenStore = await BrowserCache.getTokens();
                await BrowserCache.removeTokens(tokenStore.refreshTokens);
                await BrowserCache.removeTokens(tokenStore.accessTokens);
                await page.click("#acquireTokenPopup");
                await page.waitForSelector("#scopes-acquired");
                await screenshot.takeScreenshot(page, "acquireTokenPopupGotTokens");

                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });

            it("acquireTokenSilent from Cache", async () => {
                await page.waitForSelector("#acquireTokenSilent");
                await page.click("#acquireTokenSilent");
                await page.waitForSelector("#scopes-acquired");
                await screenshot.takeScreenshot(page, "acquireTokenSilent-fromCache-GotTokens");

                const telemetryCacheEntry = await BrowserCache.getTelemetryCacheEntry(memStorageConfig.auth.clientId);
                expect(telemetryCacheEntry).to.not.be.null;
                expect(telemetryCacheEntry["cacheHits"]).to.be.eq(1);
                // Remove Telemetry Cache entry for next test
                await BrowserCache.removeTokens([BrowserCacheUtils.getTelemetryKey(memStorageConfig.auth.clientId)]);

                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });

            it("acquireTokenSilent via RefreshToken", async () => {
                await page.waitForSelector("#acquireTokenSilent");

                // Remove access_tokens from cache so we can verify acquisition
                const tokenStore = await BrowserCache.getTokens();
                await BrowserCache.removeTokens(tokenStore.accessTokens);

                await page.click("#acquireTokenSilent");
                await page.waitForSelector("#scopes-acquired");
                await screenshot.takeScreenshot(page, "acquireTokenSilent-viaRefresh-GotTokens");

                // Verify browser cache contains Account, idToken, AccessToken and RefreshToken
                await verifyTokenStore(BrowserCache, memStorageTokenRequest.scopes);
            });
        });
    });
});