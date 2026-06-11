const fs = require("node:fs");

const socketUrl = process.env.YFONTS_CDP_WS;
const screenshotPath = process.env.YFONTS_CDP_SHOT;
const requestedTheme = process.env.YFONTS_CDP_THEME;

if (!socketUrl) {
  throw new Error("YFONTS_CDP_WS is required");
}

const socket = new WebSocket(socketUrl);
const pending = new Map();
let nextId = 0;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const callbacks = pending.get(message.id);
  if (!callbacks) return;

  pending.delete(message.id);
  if (message.error) callbacks.reject(new Error(message.error.message));
  else callbacks.resolve(message.result);
});

socket.addEventListener("open", async () => {
  try {
    if (requestedTheme === "light" || requestedTheme === "dark") {
      await send("Runtime.evaluate", {
        expression: `localStorage.setItem("yfonts:theme-mode", ${JSON.stringify(requestedTheme)}); location.reload()`
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    const expression = `JSON.stringify({
      ready: document.readyState,
      title: document.title,
      rootChildren: document.querySelector("#root")?.children.length ?? 0,
      titlebarText: document.querySelector(".window-titlebar")?.innerText ?? "",
      titlebarHeight: document.querySelector(".window-titlebar")?.getBoundingClientRect().height ?? 0,
      iconLoaded: Array.from(document.images)
        .filter((image) => image.src.includes("yfonts-icon"))
        .every((image) => image.complete && image.naturalWidth > 0),
      iconCount: Array.from(document.images)
        .filter((image) => image.src.includes("yfonts-icon")).length,
      fontRows: document.querySelectorAll(".font-row").length,
      projectItems: document.querySelectorAll(".project-pack-item").length,
      theme: document.documentElement.dataset.theme ?? "",
      resources: performance.getEntriesByType("resource")
        .filter((resource) => /index-|window-|core-|yfonts-icon/.test(resource.name))
        .map((resource) => ({
          name: resource.name.split("/").pop(),
          transferSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize
        }))
    })`;
    const state = await send("Runtime.evaluate", {
      expression,
      returnByValue: true
    });

    console.log(state.result.value);

    if (screenshotPath) {
      const screenshot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
