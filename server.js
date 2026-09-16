import { createApp } from "./server/app.js";
import { pathToFileURL } from "node:url";

// Lazy initialization lets deployment report a clear configuration error while
// keeping the source importable by Vercel's Express adapter.
import express from "express";
const app = express();
let ready;
app.use(async (req, res, next) => {
  try {
    ready ||= createApp().catch((error) => {
      ready = undefined;
      throw error;
    });
    (await ready).app(req, res, next);
  } catch (error) {
    console.error("SecureID initialization failed:", error.message);
    res
      .status(503)
      .json({
        error:
          "The authentication service is not configured yet. Please contact the site owner.",
        code: "SERVICE_UNAVAILABLE",
      });
  }
});
export default app;
if (
  !process.env.VERCEL &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "127.0.0.1", () =>
    console.log(`SecureID running at http://localhost:${port}`),
  );
}
