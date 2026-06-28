import { describe, it, expect } from "vitest";
import { FilePurpose } from "@prisma/client";
import {
  slugifyFilename,
  getFolderByPurpose,
  getPurposeByFolder,
} from "../../src/modules/files/file.utils.js";

describe("file.utils", () => {
  it("slugifies filenames to lowercase dash-separated", () => {
    expect(slugifyFilename("Hello World.png")).toBe("hello-world.png");
    expect(slugifyFilename("My  File!!.JPG")).toBe("my-file-.jpg");
  });

  it("folder <-> purpose round-trips for every known purpose", () => {
    const purposes: FilePurpose[] = [
      FilePurpose.PROFILE_PHOTO,
      FilePurpose.POST_ATTACHMENT,
      FilePurpose.DOCUMENT,
      FilePurpose.TEST_FILE,
    ];
    for (const p of purposes) {
      expect(getPurposeByFolder(getFolderByPurpose(p))).toBe(p);
    }
  });

  it("maps unknown folders to OTHER", () => {
    expect(getPurposeByFolder("nope")).toBe(FilePurpose.OTHER);
  });
});
