import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("UniteDeFi", () => {
  it("should return correct app info", () => {
    const info = app.getInfo();
    expect(info.name).toBe("Unite DeFi");
    expect(info.version).toBe("1.0.0");
  });

  it("should have required properties", () => {
    expect(app).toBeDefined();
    expect(typeof app.getInfo).toBe("function");
  });
}); 