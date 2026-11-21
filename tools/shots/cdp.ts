// 0.47: a minimal Chrome DevTools Protocol client over Bun's WebSocket (no npm dependency).
export class CdpClient {
  private ws: WebSocket; private id = 0; closed = false; private pending = new Map<number, { ok: (v: any) => void; bad: (e: Error) => void }>();
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", ev => {
      const m = JSON.parse(String(ev.data));
      const p = m.id !== undefined && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.bad(new Error(`${m.error.message} (${m.error.code})`)); else p.ok(m.result);
    });
    ws.addEventListener("close", () => { this.closed = true; for (const p of this.pending.values()) p.bad(new Error("devtools socket closed")); this.pending.clear(); });
  }
  static connect(url: string, timeoutMs = 10000): Promise<CdpClient> {
    return new Promise((ok, bad) => {
      const ws = new WebSocket(url), t = setTimeout(() => bad(new Error("devtools connect timed out")), timeoutMs);
      ws.addEventListener("open", () => { clearTimeout(t); ok(new CdpClient(ws)); });
      ws.addEventListener("error", () => { clearTimeout(t); bad(new Error("devtools connect failed")); });
    });
  }
  send(method: string, params: object = {}, timeoutMs = 60000): Promise<any> {
    const id = ++this.id;
    if (this.closed || this.ws.readyState > WebSocket.OPEN) return Promise.reject(new Error(`${method}: devtools socket closed (Chrome is gone)`)); // 0.47.1: fail now, not in 60 s
    return new Promise((ok, bad) => {
      const t = setTimeout(() => { this.pending.delete(id); bad(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { ok: v => { clearTimeout(t); ok(v); }, bad: e => { clearTimeout(t); bad(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Runtime.evaluate on our own headless page; expressions are built from our recipe files with JSON.stringify. */
  async eval(expression: string): Promise<any> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  }
  close() { this.ws.close(); }
}
