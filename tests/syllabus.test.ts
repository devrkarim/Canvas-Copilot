/**
 * Resolving a Syllabus tab that only links to a PDF — the shape of nearly every
 * real syllabus. No model calls: these cover the pure parsing + honesty helpers.
 */
import { describe, it, expect } from "vitest";
import { syllabusFileRef, syllabusToText, tabIsPointer } from "@/lib/extract/syllabus";
import { courseHasSyllabus, syllabusReadable, type CourseRow } from "@/lib/db";

const CANVAS = "https://northeastern.instructure.com";

/** Verbatim shape of a real Canvas Syllabus tab: a stylesheet and one file link. */
const LINK_ONLY_HTML = `<link rel="stylesheet" href="https://instructure-uploads.s3.amazonaws.com/account_1/attachments/22977598/dp_app.css"><p><a class="instructure_file_link" title="CS3650_syllabus_f26.pdf" href="${CANVAS}/courses/260836/files/43962958?location=course_syllabus_260836&amp;wrap=1" target="_blank" data-api-endpoint="${CANVAS}/api/v1/courses/260836/files/43962958" data-api-returntype="File">CS3650_syllabus_f26.pdf</a></p>`;

describe("syllabusFileRef", () => {
  it("finds the linked file in a real link-only syllabus tab", () => {
    expect(syllabusFileRef(LINK_ONLY_HTML, CANVAS)).toEqual({ courseId: 260836, fileId: 43962958 });
  });

  it("reads the plain href form when there is no data-api-endpoint", () => {
    const html = `<a href="${CANVAS}/courses/1/files/2?wrap=1">Syllabus.pdf</a>`;
    expect(syllabusFileRef(html, CANVAS)).toEqual({ courseId: 1, fileId: 2 });
  });

  it("accepts relative links", () => {
    expect(syllabusFileRef(`<a href="/courses/7/files/8">s.pdf</a>`, CANVAS)).toEqual({ courseId: 7, fileId: 8 });
  });

  it("ignores file links pointing at another host, so the Canvas token is never sent off-site", () => {
    const hostile = `<a href="https://evil.example.com/courses/1/files/2">Syllabus.pdf</a>`;
    expect(syllabusFileRef(hostile, CANVAS)).toBeNull();
    // …and still finds the legitimate link when both are present.
    expect(syllabusFileRef(hostile + LINK_ONLY_HTML, CANVAS)).toEqual({ courseId: 260836, fileId: 43962958 });
  });

  it("ignores absolute links when the Canvas origin is unknown", () => {
    expect(syllabusFileRef(LINK_ONLY_HTML, null)).toBeNull();
  });

  it("returns null for a syllabus with prose but no attachment", () => {
    expect(syllabusFileRef("<p>Late work loses 10% per day.</p>", CANVAS)).toBeNull();
  });

  it("ignores non-file links such as the stylesheet", () => {
    expect(syllabusFileRef(`<link rel="stylesheet" href="${CANVAS}/style.css">`, CANVAS)).toBeNull();
  });
});

describe("tabIsPointer", () => {
  // Real measurements: link-only tabs are 131 and 344 chars; a syllabus written
  // into the tab is ~21,800. The attachment is only followed for the former.
  it("treats a bare link tab as a pointer", () => {
    expect(tabIsPointer(syllabusToText(LINK_ONLY_HTML))).toBe(true);
  });

  it("does not treat a prose syllabus as a pointer, even though it links to files", () => {
    // Shape of a real prose tab: the syllabus itself plus a link to a course reading.
    const prose =
      `<p>Professor: Mark Wells. Office: 420V Renaissance Park. Office Hours: Thursday 9:00am - 1:00pm.</p>` +
      `<p>${"Course policies and weekly schedule. ".repeat(80)}</p>` +
      `<p><a href="${CANVAS}/courses/234526/files/36301221">But how do I participate_ 2021 edition.pdf</a></p>`;
    const text = syllabusToText(prose);
    expect(text.length).toBeGreaterThan(1500);
    expect(tabIsPointer(text)).toBe(false);
    // The link is still findable — it just must not be followed for this tab.
    expect(syllabusFileRef(prose, CANVAS)).not.toBeNull();
  });
});

describe("courseHasSyllabus", () => {
  const row = (over: Partial<CourseRow>) => ({ syllabus_available: 1, syllabus_source: null, ...over } as CourseRow);

  it("does not count a tab that is only an unreadable attachment", () => {
    expect(courseHasSyllabus(row({ syllabus_source: "link_only" }))).toBe(false);
  });

  it("counts a syllabus read out of a PDF", () => {
    expect(courseHasSyllabus(row({ syllabus_source: "pdf" }))).toBe(true);
  });

  it("counts prose written straight into the tab", () => {
    expect(courseHasSyllabus(row({ syllabus_source: "html" }))).toBe(true);
  });

  it("falls back to the old flag for rows synced before syllabus_source existed", () => {
    expect(courseHasSyllabus(row({ syllabus_available: 1 }))).toBe(true);
    expect(courseHasSyllabus(row({ syllabus_available: 0 }))).toBe(false);
  });

  it("syllabusReadable rejects none and link_only", () => {
    expect([syllabusReadable("none"), syllabusReadable("link_only"), syllabusReadable(null)]).toEqual([false, false, false]);
  });
});
