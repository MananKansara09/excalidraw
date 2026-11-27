import { spawn } from "node:child_process";

/** stops a CLI and, on Windows, whatever it started */
export const killTree = (proc) => {
  if (proc.exitCode !== null || !proc.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      stdio: "ignore",
    }).on("error", () => proc.kill());
  } else {
    proc.kill();
  }
};
