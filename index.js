const chrome_debugging_client = require("chrome-debugging-client");
const http = require("http");
const fs = require("fs");
const path = require("path");
const handler = require("serve-handler");
const { performance, PerformanceObserver } = require("perf_hooks");

const spawnChrome = performance.timerify(chrome_debugging_client.spawnChrome);

const observer = new PerformanceObserver((list) => {
  console.log(list.getEntries());
});

observer.observe({ entryTypes: ["function"] });

const INJECTED_SCRIPT = fs.readFileSync(
  path.join(__dirname, "injected.js"),
  "utf8"
);

const server = http.createServer((request, response) => {
  return handler(request, response);
});

async function main() {
  await new Promise((resolve) => server.listen(3000, resolve));
  console.log("Running at http://localhost:3000");
  const chrome = spawnChrome({
    headless: true,
    chromeExecutable:
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  });
  try {
    const browser = chrome.connection;

    // await browser.send("Target.setDiscoverTargets", {
    //   discover: true,
    // });

    const { browserContextId } = await browser.send(
      "Target.createBrowserContext",
      {}
    );
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const page = await browser.attachToTarget(targetId);

    const { targetInfos } = await browser.send("Target.getTargets");

    console.log(targetInfos);

    // close other targets
    for (const targetInfo of targetInfos) {
      if (targetInfo.type === "page" && targetInfo.targetId !== targetId) {
        await browser.send("Target.closeTarget", {
          targetId: targetInfo.targetId,
        });
      }
    }

    page.on("Runtime.exceptionThrown", (event) => {
      console.log("Runtime.exceptionThrown", event);
    });

    await page.send("Runtime.enable", { enable: true });
    await page.send("Runtime.addBinding", { name: "__stopTrace" });

    const stopTraceRequested = new Promise((resolve) => {
      page.on("Runtime.bindingCalled", (event) => {
        console.log("Runtime.bindingCalled", event);
        if (event.name === "__stopTrace") {
          resolve();
        }
      });
    });

    await page.send("Page.addScriptToEvaluateOnLoad", {
      scriptSource: INJECTED_SCRIPT,
    });

    await page.send("Page.enable", { enable: true });

    console.log("starting trace");

    await page.send("Tracing.start", {
      categories:
        "-*,blink.user_timing,blink_gc,devtools.timeline,rail,v8,v8.execute",
      transferMode: "ReturnAsStream",
      streamFormat: "json",
    });

    console.log("navigating");

    const [, navigationEvent] = await Promise.all([
      page.until("Page.loadEventFired"),
      page.send("Page.navigate", {
        url: "http://localhost:3000/index.html",
      }),
    ]);

    if (navigationEvent.errorText) {
      throw new Error(navigationEvent.errorText);
    }

    await stopTraceRequested;
    console.log("stopping trace");

    const [{ stream: handle }] = await Promise.all([
      page.until("Tracing.tracingComplete"),
      page.send("Tracing.end"),
    ]);

    console.log("trace complete");

    const fd = fs.openSync("trace.json", "w");
    try {
      while (true) {
        const { base64Encoded, eof, data } = await page.send("IO.read", {
          handle,
        });
        const encoding = base64Encoded ? "base64" : "utf8";
        fs.writeSync(fd, data, null, encoding);
        if (eof) break;
      }
    } finally {
      fs.closeSync(fd);
      await page.send("IO.close", { handle });
    }

    await browser.send("Target.detachFromTarget", {
      sessionId: page.sessionId,
    });

    await browser.send("Target.disposeBrowserContext", {
      browserContextId,
    });

    await chrome.close();
  } finally {
    await chrome.dispose();
    await new Promise((resolve, reject) =>
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      })
    );
    server.close();
  }
}

main().catch((err) => {
  console.log("%o", err);
});
