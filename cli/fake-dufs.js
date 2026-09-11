/* An in-memory dufs, for the test. Speaks exactly the subset of dufs 0.46 the
   web UI uses -- GET ?json to list, MKCOL for a folder, PUT to upload, GET and
   HEAD for a file -- with dufs's own status codes, so the CLI cannot tell it
   from the real thing on 192.168.1.42. Everything is served under /score. */
"use strict";
const http = require("http");

function fakeDufs() {
  const files = new Map();          /* name -> Buffer */
  let folder = false;               /* has /score been created */
  const log = [];                   /* "METHOD /path" per request, for assertions */

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://fake");
    log.push(`${req.method} ${u.pathname}${u.search}`);
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const end = (code, headers, out) => { res.writeHead(code, headers || {}); res.end(out); };
      if (u.pathname !== "/score" && !u.pathname.startsWith("/score/")) return end(404);
      const name = decodeURIComponent(u.pathname.slice("/score".length).replace(/^\//, ""));

      if (req.method === "MKCOL") {
        if (folder) return end(405);                       /* dufs: already exists */
        folder = true; return end(201);
      }
      if (name === "" && u.searchParams.has("json")) {
        if (!folder) return end(404);
        const paths = [...files].map(([n, b]) => ({ path_type: "File", name: n, size: b.length, mtime: 0 }));
        return end(200, { "content-type": "application/json" }, JSON.stringify({ href: "/score/", kind: "Index", paths }));
      }
      if (req.method === "PUT") {
        folder = true;                                       /* dufs creates parents on PUT */
        files.set(name, body); return end(201);
      }
      const b = files.get(name);
      if (req.method === "HEAD") return b ? end(200, { "content-length": String(b.length) }) : end(404);
      if (req.method === "GET")  return b ? end(200, { "content-length": String(b.length) }, b) : end(404);
      end(405);
    });
  });

  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/score`,
    files, log,
    get folder() { return folder; },
    close: () => new Promise(r => server.close(r)),
  })));
}

module.exports = { fakeDufs };
