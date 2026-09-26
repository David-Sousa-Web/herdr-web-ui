import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { workspaceCreate, workspaceClose } from "./herdr/client.ts";
import type { ServerMessage } from "../shared/protocol.ts";

const guard = { "x-herdr-machine": "1", "content-type": "application/json" };

async function connect(url: string, cookie: string) {
  // Bun supports handshake headers; lib.dom's browser constructor does not list them.
  const RuntimeSocket = WebSocket as unknown as new (url: string, options: { headers: { cookie: string } }) => WebSocket;
  const socket = new RuntimeSocket(url, { headers: { cookie } });
  const messages: ServerMessage[] = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve, { once: true }));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { socket, messages, closed };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for websocket output");
    await Bun.sleep(20);
  }
}

it("revocation closes an active device's terminal and roster stream without disconnecting another device", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-device-access-"));
  const server = createServer({ port: 0, stateDir: root, token: "test-device-access", tailscaleOwner: null });
  const base = `http://127.0.0.1:${server.port}`;
  const admin = { ...guard, authorization: "Bearer test-device-access" };
  const sockets: WebSocket[] = [];
  const abort = new AbortController();
  let workspaceId: string | undefined;
  try {
    const pair = async (label: string) => {
      const { code } = await (await fetch(`${base}/api/devices/pair/start`, { method: "POST", headers: admin })).json() as { code: string };
      const response = await fetch(`${base}/api/devices/pair`, { method: "POST", headers: guard, body: JSON.stringify({ code, label }) });
      expect(response.status).toBe(204);
      return response.headers.get("set-cookie")!.split(";")[0]!;
    };
    const cookieA = await pair("A");
    const cookieB = await pair("B");
    const { devices } = await (await fetch(`${base}/api/devices`, { headers: admin })).json() as { devices: { id: string; label: string }[] };
    const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-device-revocation" });
    workspaceId = created.workspace.workspace_id;
    const paneId = created.root_pane.pane_id;
    const a = await connect(`${base.replace("http:", "ws:")}/ws`, cookieA); sockets.push(a.socket);
    const b = await connect(`${base.replace("http:", "ws:")}/ws`, cookieB); sockets.push(b.socket);
    for (const client of [a, b]) {
      client.socket.send(JSON.stringify({ type: "attach", pane_id: paneId, cols: 80, rows: 24 }));
      await until(() => client.messages.some((message) => message.type === "pty-data"));
    }
    const events = await fetch(`${base}/api/machines/events`, { headers: { cookie: cookieA }, signal: abort.signal });
    const reader = events.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    const ended = (async () => { while (!(await reader.read()).done) {} })();
    expect((await fetch(`${base}/api/devices/${devices.find((device) => device.label === "A")!.id}`, { method: "DELETE", headers: admin })).status).toBe(204);
    expect((await a.closed).code).toBe(1008);
    await ended;
    expect((await fetch(`${base}/api/session`, { headers: { cookie: cookieA } })).status).toBe(401);
    b.socket.send(JSON.stringify({ type: "role", mode: "observe" }));
    await until(() => b.messages.some((message) => message.type === "role-ack" && message.mode === "observe"));
    expect(b.socket.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(`${base}/api/session`, { headers: { cookie: cookieB } })).status).toBe(200);
  } finally {
    abort.abort();
    for (const socket of sockets) socket.close();
    server.stop();
    if (workspaceId) await workspaceClose(workspaceId);
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

it("a corrupt device registry refuses strangers while keeping local recovery and the original file", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-device-recovery-"));
  const path = join(root, "devices.json");
  writeFileSync(path, "{broken registry");
  const server = createServer({ port: 0, stateDir: root, token: "", tailscaleOwner: null });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/api/session`, { headers: { "x-forwarded-for": "192.0.2.1" } })).status).toBe(401);
    expect((await fetch(`${base}/api/session`)).status).toBe(200);
    const response = await fetch(`${base}/api/devices/pair/start`, { method: "POST", headers: guard });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "device_store_unavailable" } });
    expect(readFileSync(path, "utf8")).toBe("{broken registry");
  } finally { server.stop(); rmSync(root, { recursive: true, force: true }); }
});
