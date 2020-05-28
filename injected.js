"use strict";
(() => {
  if (self !== top || opener !== null) {
    return;
  }
  const observer = new PerformanceObserver((list, observer) => {
    console.log(JSON.stringify(list.getEntries()));
    if (list.getEntriesByName("initial_render_done", "mark").length > 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => __stopTrace("")));
      observer.disconnect();
    }
  });
  observer.observe({ entryTypes: ["mark", "navigation"] });
})();
