import { createApp } from "./lib/server.mjs";
import { run } from "./project.mjs";
import { fileURLToPath } from "node:url";
const server = createApp({
  project: {
    id: "chatgpt-allocation-lab",
    title: "Allocation Lab",
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  run,
});
const port = Number(process.env.PORT || 3207);
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    "Allocation Lab" +
      " → http://" +
      (process.env.HOST || "127.0.0.1") +
      ":" +
      port,
  ),
);
