/** @type {import("next").NextConfig} */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  turbopack: { root: resolve(__dirname) }
};
export default config;
