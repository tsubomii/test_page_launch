"use strict";
var __tracerbench = self === top &&
  opener === null &&
  new Promise((resolve) =>
    new PerformanceObserver((records, observer) => {
      const [entry] = records.getEntries();
      if (entry) {
        resolve(entry.toJSON());
        observer.disconnect();
      }
    }).observe({ type: "largest-contentful-paint" })
  );
