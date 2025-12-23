import request from "supertest";
import app from "../server";

describe("POST /", () => {
  it("debería responder con { message: 'working' }", async () => {
    const res = await request(app).post("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "working" });
  });
});


