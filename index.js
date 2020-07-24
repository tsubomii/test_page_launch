const { spawnChrome } = require("chrome-debugging-client");
const fs = require("fs");
const path = require("path");
const debug = require("debug")("test_page_launch");

const INJECTED_SCRIPT = fs.readFileSync(
  path.join(__dirname, "injected.js"),
  "utf8"
);

async function main() {
  /** @type {{url: string; cookies?: import('devtools-protocol').Protocol.Network.CookieParam[]}} */
  const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const chrome = spawnChrome({
    headless: true,
    // chromeExecutable: `/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`,
    // stdio: "inherit",
    // additionalArguments: ["--enable-logging", "--v=1"],
  });
  try {
    const browser = chrome.connection;

    const { browserContextId } = await browser.send(
      "Target.createBrowserContext",
      {}
    );
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const page = await browser.attachToTarget(targetId);
    await page.send("Page.enable");
    // await page.send("Runtime.enable");
    const {
      frameTree: { frame },
    } = await page.send("Page.getFrameTree");

    debug("frame %o", frame);

    const { targetInfos } = await browser.send("Target.getTargets");

    debug("targetInfos %o", frame);

    // close other targets
    for (const targetInfo of targetInfos) {
      if (targetInfo.type === "page" && targetInfo.targetId !== targetId) {
        await browser.send("Target.closeTarget", {
          targetId: targetInfo.targetId,
        });
      }
    }

    const window = await browser.send("Browser.getWindowForTarget", {
      targetId,
    });

    debug("window %o", window);

    await browser.send("Browser.setWindowBounds", {
      windowId: window.windowId,
      bounds: {
        top: 0,
        left: 0,
        width: 1024,
        height: 768,
      },
    });

    const { url, cookies } = config;

    if (cookies) {
      console.log("setting cookies");
      await page.send("Network.setCookies", {
        cookies,
      });
    }

    await page.send("Page.addScriptToEvaluateOnLoad", {
      scriptSource: INJECTED_SCRIPT,
    });

    await page.send("Performance.enable");

    console.log("starting trace");
    await page.send("Tracing.start", {
      categories: [
        "-*",
        "devtools",
        "devtools.timeline",
        "devtools.timeline.async",
        "v8.execute",
        "toplevel",
        "blink.console",
        "blink.user_timing",
        "latencyInfo",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "disabled-by-default-devtools.timeline.stack",
        "disabled-by-default-v8.runtime_stats_sampling",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-devtools.timeline.invalidationTracking",
        "disabled-by-default-devtools.screenshot",
      ].join(","),
      transferMode: "ReturnAsStream",
      streamFormat: "json",
    });

    console.log("navigating");

    const [, navigationEvent] = await Promise.all([
      page.until("Page.loadEventFired"),
      page.send("Page.navigate", {
        url,
      }),
    ]);

    if (navigationEvent.errorText) {
      throw new Error(navigationEvent.errorText);
    }

    const result = await page.send("Runtime.evaluate", {
      expression: "__tracerbench",
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("stopping trace", result);

    const [{ stream: handle }] = await Promise.all([
      page.until("Tracing.tracingComplete"),
      page.send("Tracing.end"),
    ]);

    console.log("trace complete");

    if (handle !== undefined) {
      await saveTrace(page, handle);
    }

    console.log(await page.send("Performance.getMetrics"));

    await browser.send("Target.disposeBrowserContext", {
      browserContextId,
    });

    await chrome.close();
  } finally {
    await chrome.dispose();
  }

  console.log(
    "open traces/trace.json in chrome://tracing or in the DevTools Performance tab to view"
  );
}

main().catch((err) => {
  debug("%o", err);
  throw err;
});

/**
 * @param {import("chrome-debugging-client").SessionConnection} page
 * @param {string} handle
 */
async function saveTrace(page, handle) {
  let totalLength = 0;
  /** @type {Buffer[]} */
  const buffers = [];
  try {
    /** @type {import("devtools-protocol").Protocol.IO.ReadResponse} */
    let read;
    do {
      read = await page.send("IO.read", {
        handle,
      });
      const encoding = read.base64Encoded ? "base64" : "utf8";
      const buffer = Buffer.from(read.data, encoding);
      if (buffer.length > 0) {
        buffers.push(buffer);
        totalLength += buffer.byteLength;
      }
    } while (!read.eof);
  } finally {
    await page.send("IO.close", { handle });
  }
  writeTrace("trace.json", Buffer.concat(buffers, totalLength));
}

/**
 * @param {string} file
 * @param {Buffer} trace
 */
function writeTrace(file, trace) {
  try {
    fs.mkdirSync(path.join(__dirname, "traces"));
  } catch (e) {
    if (e.code !== "EEXIST") {
      throw e;
    }
  }
  fs.writeFileSync(path.join(__dirname, "traces", file), trace);
}
