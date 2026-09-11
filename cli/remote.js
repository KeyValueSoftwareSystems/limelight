/* The seam between the commands and wherever scores live.
   ---------------------------------------------------------------------------
   openRemote(url) looks at the scheme and hands back { list, put, get, size }.
   Today the only backend speaks the dufs dialect, which is what our own hub
   (hub/hub.py, at /hub on serve.py) speaks, and what a real dufs speaks too:

     GET  <base>/?json          list the folder     -> { paths: [{ name, path_type, size }] }
     MKCOL <base>               create the folder   -> 201, or 405 when it already exists
     PUT  <base>/<name>         upload, raw bytes    -> 201 (overwrites)
     GET  <base>/<name>         download
     HEAD <base>/<name>         content-length, to check an upload landed whole

   Cloud storage later is another function here and one more case in the
   switch. The commands never learn which one they are talking to. */
"use strict";

const DEFAULT_REMOTE = "http://127.0.0.1:8770/hub/score";   /* our own hub; serve.py prints the LAN form */

class RemoteError extends Error {}
class NotFound extends RemoteError {}
class Unreachable extends RemoteError {}

function openRemote(url) {
  const scheme = new URL(url).protocol;
  switch (scheme) {
    case "http:": case "https:": return dufs(url);
    default: throw new RemoteError(`no backend for ${scheme}// remotes yet (LIMELIGHT_REMOTE=${url})`);
  }
}

function dufs(base) {
  base = base.replace(/\/+$/, "");
  /* the same URL the web UI builds: base, slash, each segment encoded */
  const fileUrl = name => base + "/" + name.split("/").map(encodeURIComponent).join("/");

  async function call(method, url, body) {
    try {
      return await fetch(url, { method, body });
    } catch (e) {
      throw new Unreachable(`cannot reach ${base} — is the server up? Override with LIMELIGHT_REMOTE=<url>`);
    }
  }
  async function fail(method, url, res) {
    const line = (await res.text().catch(() => "")).split("\n")[0].trim().slice(0, 200);
    throw new RemoteError(`${method} ${url} → ${res.status} ${res.statusText}${line ? " — " + line : ""}`);
  }

  let folderExists = false;

  async function list() {
    const url = base + "/?json";
    const res = await call("GET", url);
    if (res.status === 404) return [];
    if (!res.ok) await fail("GET", url, res);
    folderExists = true;
    const data = await res.json();
    return (data.paths || []).filter(p => p.path_type === "File").map(p => p.name);
  }

  async function ensureFolder() {
    if (folderExists) return;
    const probe = await call("GET", base + "/?json");
    if (probe.ok) { folderExists = true; return; }
    const res = await call("MKCOL", base);
    if (!res.ok && res.status !== 405) await fail("MKCOL", base, res);
    folderExists = true;
  }

  async function put(name, bytes) {
    await ensureFolder();
    const url = fileUrl(name);
    const res = await call("PUT", url, bytes);
    if (!res.ok) await fail("PUT", url, res);
  }

  async function get(name) {
    const url = fileUrl(name);
    const res = await call("GET", url);
    if (res.status === 404) throw new NotFound(`${name} is not on ${base}`);
    if (!res.ok) await fail("GET", url, res);
    return Buffer.from(await res.arrayBuffer());
  }

  async function size(name) {
    const url = fileUrl(name);
    const res = await call("HEAD", url);
    if (res.status === 404) return null;
    if (!res.ok) await fail("HEAD", url, res);
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) ? n : null;
  }

  return { base, url: fileUrl, list, put, get, size };
}

module.exports = { openRemote, DEFAULT_REMOTE, RemoteError, NotFound, Unreachable };
