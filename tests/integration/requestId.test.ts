import { describe, it, expect } from "vitest";
import { request } from "../helpers/auth.js";

describe("request id / correlation", () => {
  it("returns an x-request-id header on every response", async () => {
    const res = await request.get("/");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("reuses an incoming x-request-id", async () => {
    const res = await request.get("/").set("x-request-id", "test-corr-xyz");
    expect(res.headers["x-request-id"]).toBe("test-corr-xyz");
  });
});
