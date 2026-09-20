import fs from "node:fs";
import path from "node:path";

/** Start every test run from an empty database. */
export default function setup() {
  const dir = path.join(import.meta.dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["test.db", "test.db-wal", "test.db-shm"]) fs.rmSync(path.join(dir, f), { force: true });
}
