// A `tsparse -serve` child: one JSON request per line in, one JSON answer per line out (see tsparse/main.go).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function startTs(bin) {
  const child = spawn(bin, ["-serve"], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  createInterface({ input: child.stdout }).on("line", (l) => waiting.shift()?.(JSON.parse(l)));
  return {
    ask: (req) => new Promise((res) => { waiting.push(res); child.stdin.write(JSON.stringify(req) + "\n"); }),
    close: () => child.stdin.end(),
  };
}
