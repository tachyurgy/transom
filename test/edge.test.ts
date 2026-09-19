import { describe, it, expect } from "vitest";
import { buildOriginRequest, rewriteResponseHeaders } from "../src/edge";

describe("edge: origin request", () => {
  it("keeps path + query, swaps host, adds forwarding headers, strips hop-by-hop", () => {
    const req = new Request("https://plumbline-edge.levelbrook.com/subs?tab=expiring", {
      headers: { "cf-connecting-ip": "203.0.113.9", connection: "keep-alive", "user-agent": "ua" },
    });
    const out = buildOriginRequest(req, "https://plumbline.levelbrook.com", "rid-1");
    expect(out.url).toBe("https://plumbline.levelbrook.com/subs?tab=expiring");
    expect(out.headers.get("x-forwarded-host")).toBe("plumbline-edge.levelbrook.com");
    expect(out.headers.get("x-request-id")).toBe("rid-1");
    expect(out.headers.get("x-edge-client-ip")).toBe("203.0.113.9");
    expect(out.headers.get("connection")).toBeNull();
    expect(out.headers.get("user-agent")).toBe("ua");
    expect(out.redirect).toBe("manual");
  });
});

describe("edge: response headers", () => {
  it("strips fingerprint headers and adds the edge + security baseline", () => {
    const h = new Headers({ "x-powered-by": "Next.js", server: "Vercel", "x-vercel-id": "abc", "content-type": "text/html" });
    rewriteResponseHeaders(h, "rid-2", "HIT");
    expect(h.get("x-powered-by")).toBeNull();
    expect(h.get("server")).toBeNull();
    expect(h.get("x-vercel-id")).toBeNull();
    expect(h.get("x-edge")).toBe("transom");
    expect(h.get("x-edge-cache")).toBe("HIT");
    expect(h.get("x-request-id")).toBe("rid-2");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-type")).toBe("text/html");
  });
});
