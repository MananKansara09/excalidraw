/**
 * Sign-ins where a CLI prints a link and then waits for the code the user gets
 * after approving: one pending sign-in per user (Claude and Antigravity).
 */
import { killTree } from "./process.mjs";

const LOGIN_TTL = 10 * 60 * 1000;
const START_TIMEOUT = 30000;
const SUBMIT_TIMEOUT = 20000;

/** `findUrl(output)` returns the sign-in link once the CLI has printed it all */
export const createCodeLogins = (findUrl) => {
  const logins = new Map(); // userId -> { proc, output, exited, timer }

  const drop = (userId, entry) => {
    clearTimeout(entry.timer);
    // a newer sign-in may have taken this one's place
    if (logins.get(userId) === entry) {
      logins.delete(userId);
    }
  };

  const cancel = (userId) => {
    const entry = logins.get(userId);
    if (entry) {
      killTree(entry.proc);
      drop(userId, entry);
    }
  };

  /** `spawnCli()` starts the sign-in command with piped stdio */
  const start = (userId, spawnCli) =>
    new Promise((resolve, reject) => {
      cancel(userId);
      const proc = spawnCli();
      const entry = {
        proc,
        output: "",
        exited: null,
        timer: setTimeout(() => cancel(userId), LOGIN_TTL),
      };
      logins.set(userId, entry);
      let done = false;
      const settle = (error, url) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(startTimer);
        if (error) {
          killTree(proc);
          drop(userId, entry);
          reject(error);
        } else {
          resolve(url);
        }
      };
      const startTimer = setTimeout(
        () => settle(new Error("Timed out starting login")),
        START_TIMEOUT,
      );
      const onData = (d) => {
        entry.output += d;
        const url = findUrl(entry.output);
        if (url) {
          settle(null, url);
        }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      // writing to a CLI that just exited must not take the bridge down
      proc.stdin.on("error", () => {});
      proc.on("error", settle);
      proc.on("close", (code) => {
        entry.exited = code;
        settle(
          new Error(
            entry.output.trim().slice(0, 300) || "login failed to start",
          ),
        );
      });
    });

  /** `verify()` says whether the user really is signed in now */
  const submit = (userId, code, verify) =>
    new Promise((resolve) => {
      const entry = logins.get(userId);
      if (!entry || entry.exited !== null) {
        return resolve({ ok: false, message: "Login expired. Start again." });
      }
      const finish = (ok, message) => {
        clearTimeout(timer);
        drop(userId, entry);
        resolve({ ok, message });
      };
      const timer = setTimeout(() => {
        killTree(entry.proc);
        finish(false, "Timed out. Start again.");
      }, SUBMIT_TIMEOUT);
      entry.proc.on("close", async (exitCode) => {
        if (exitCode !== 0) {
          return finish(false, "That code didn't work. Start again.");
        }
        const ok = await verify();
        finish(ok, ok ? "" : "Sign-in did not complete.");
      });
      entry.proc.stdin.write(`${code}\n`);
    });

  return { start, submit, cancel };
};
