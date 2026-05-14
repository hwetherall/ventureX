import { describe, expect, it } from "vitest";
import { parseDocument, UnsupportedFileTypeError } from "./index";

describe("parseDocument — D2 rejections", () => {
  it("rejects PPTX with a copy-paste-able user message", async () => {
    await expect(
      parseDocument(
        Buffer.from("not-a-real-pptx"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).rejects.toMatchObject({
      name: "UnsupportedFileTypeError",
      userMessage: expect.stringMatching(/PPTX.*export.*PDF/i),
    });
  });

  it("rejects legacy .ppt as well", async () => {
    await expect(
      parseDocument(
        Buffer.from("not-a-real-ppt"),
        "application/vnd.ms-powerpoint",
      ),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it("rejects unknown MIME types with a useful message", async () => {
    try {
      await parseDocument(Buffer.from("data"), "image/jpeg");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFileTypeError);
      expect((err as UnsupportedFileTypeError).userMessage).toMatch(
        /image\/jpeg.*Accepted: PDF, DOCX/,
      );
    }
  });
});
