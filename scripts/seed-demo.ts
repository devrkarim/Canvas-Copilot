/**
 * Seed data/app.db with a realistic fake semester so the UI and chat can be
 * demoed without a Canvas token.   Run:  npm run seed
 */
import { db, setPref, createProposal, nowIso } from "../lib/db.ts";

const conn = db();
const ts = nowIso();
const day = 24 * 3600 * 1000;
const at = (daysFromNow: number, hour: number, minute = 0) => {
  const d = new Date(Date.now() + daysFromNow * day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (daysFromNow: number) => {
  const d = new Date(Date.now() + daysFromNow * day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

for (const t of ["study_blocks", "forecasts", "proposals", "office_hours", "calendar_events", "announcements", "assignments", "courses", "briefings"]) {
  conn.prepare(`DELETE FROM ${t}`).run();
}
setPref("me_id", "4242");
setPref("me_name", "Jordan Rivera");
setPref("last_sync", ts);

const termEnd = new Date(Date.now() + 70 * day).toISOString();
const courses = [
  {
    id: 101, name: "Introduction to Computer Science", code: "CS 101", instr: "Dr. Priya Nair", email: "pnair@university.edu", uid: 9001,
    late: "Late work loses 10% per day, up to 3 days. After that, no credit without a documented excuse.",
    weights: [{ name: "Homework", percent: 40 }, { name: "Midterm", percent: 25 }, { name: "Final", percent: 35 }],
    oh: [{ who: "Dr. Priya Nair", dow: 2, s: "14:00", e: "15:30", loc: "Gates 214" }, { who: "TA Marcus Lee", dow: 4, s: "10:00", e: "11:00", loc: "Zoom" }],
  },
  {
    id: 202, name: "General Chemistry II", code: "CHEM 122", instr: "Prof. Daniel Okafor", email: "dokafor@university.edu", uid: 9002,
    late: "No late submissions are accepted for problem sets. Lab reports may be submitted up to 48 hours late with a 20% penalty.",
    weights: [{ name: "Problem sets", percent: 20 }, { name: "Labs", percent: 30 }, { name: "Exams", percent: 50 }],
    oh: [{ who: "Prof. Daniel Okafor", dow: 1, s: "13:00", e: "14:00", loc: "Chem 305" }],
  },
  {
    id: 303, name: "American Literature Since 1865", code: "ENGL 240", instr: "Dr. Hannah Weiss", email: "hweiss@university.edu", uid: 9003,
    late: "Essays may be turned in up to one week late with a one-third letter grade deduction per day.",
    weights: [{ name: "Essays", percent: 60 }, { name: "Participation", percent: 15 }, { name: "Final", percent: 25 }],
    oh: [] as Array<{ who: string; dow: number; s: string; e: string; loc: string }>,
  },
];

const insCourse = conn.prepare(
  `INSERT INTO courses(id, name, course_code, term_name, term_end, syllabus_body, syllabus_available, syllabus_extracted_at, instructor_name, instructor_email, instructor_user_id, late_policy, grading_weights, exam_dates, synced_at)
   VALUES(?, ?, ?, 'Fall 2026', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insOh = conn.prepare("INSERT INTO office_hours(course_id, instructor, day_of_week, start_time, end_time, location, modality) VALUES(?, ?, ?, ?, ?, ?, ?)");
for (const c of courses) {
  const hasSyl = c.id !== 303; // ENGL 240 has no Syllabus tab on purpose
  const ohText = c.oh.map((o) => `${o.who}: ${DOW[o.dow]} ${o.s}-${o.e} (${o.loc})`).join("; ");
  const syl = hasSyl
    ? `<h2>${c.name}</h2><p>Instructor: ${c.instr} (${c.email})</p><p><b>Office hours:</b> ${ohText}</p><p><b>Late policy:</b> ${c.late}</p><p><b>Grading:</b> ${c.weights.map((w) => `${w.name} ${w.percent}%`).join(", ")}</p>`
    : null;
  insCourse.run(
    c.id, c.name, c.code, termEnd, syl, hasSyl ? 1 : 0, hasSyl ? ts : null, c.instr, c.email, c.uid,
    hasSyl ? c.late : null, hasSyl ? JSON.stringify(c.weights) : null,
    hasSyl ? JSON.stringify([{ name: "Midterm", date: dateOnly(12), notes: null }]) : null, ts,
  );
  for (const o of c.oh) insOh.run(c.id, o.who, o.dow, o.s, o.e, o.loc, o.loc === "Zoom" ? "online" : "in_person");
}

const insA = conn.prepare(
  `INSERT INTO assignments(id, course_id, name, description, due_at, points_possible, submission_types, html_url, submitted, score, missing, synced_at)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const A = (id: number, cid: number, name: string, desc: string, due: string, pts: number, types: string[], submitted = 0, missing = 0) =>
  insA.run(id, cid, name, `<p>${desc}</p>`, due, pts, JSON.stringify(types), `https://canvas.example.edu/courses/${cid}/assignments/${id}`, submitted, submitted ? pts * 0.9 : null, missing, ts);

A(1001, 101, "HW3: Recursion", "Implement 5 recursive functions (factorial, fib, binary search, flood fill, permutations) with tests.", at(1, 23, 59), 100, ["online_upload"]);
A(1002, 101, "HW2: Loops and Lists", "Practice problems on loops and list comprehension.", at(-4, 23, 59), 100, ["online_upload"], 0, 1);
A(1003, 101, "Midterm Exam", "In-class exam covering weeks 1-7.", at(12, 10), 200, ["on_paper"]);
A(1004, 101, "HW4: Objects and Classes", "Model a library system with classes; about 200 lines of Python.", at(8, 23, 59), 100, ["online_upload"]);
A(2001, 202, "Problem Set 6: Thermodynamics", "20 problems on enthalpy, entropy, and Gibbs free energy.", at(2, 17), 50, ["online_upload"]);
A(2002, 202, "Lab Report 4: Calorimetry", "Full lab write-up: abstract, methods, data tables, error analysis, discussion (6-8 pages).", at(5, 23, 59), 100, ["online_upload"]);
A(2003, 202, "Problem Set 5: Kinetics", "Rate laws and Arrhenius problems.", at(-9, 17), 50, ["online_upload"], 1);
A(3001, 303, "Essay 2: Realism and Naturalism", "5-6 page essay comparing two assigned novels; MLA citations required.", at(6, 23, 59), 150, ["online_upload"]);
A(3002, 303, "Reading Response: Whitman", "300-word response on the assigned poems.", at(0, 23, 59), 10, ["online_text_entry"]);
A(3003, 303, "Discussion: Twain", "Post once, reply twice.", at(3, 23, 59), 20, ["discussion_topic"]);

const insAnn = conn.prepare("INSERT INTO announcements(id, course_id, title, message, posted_at, html_url, processed, actions, synced_at) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?)");
insAnn.run(
  5001, 101, "HW3 deadline extended",
  "<p>Hi all - since the autograder was down yesterday, HW3 is now due <b>two days later</b> at 11:59pm. Use the time to add tests!</p>",
  at(-1, 9), "https://canvas.example.edu/courses/101/discussion_topics/5001",
  JSON.stringify({ isActionable: true, tldr: "HW3 due date pushed back two days because the autograder was down.", actions: [{ kind: "due_date_change", assignmentId: 1001, assignmentName: "HW3: Recursion", newDueAt: at(3, 23, 59), summary: "HW3 moved two days later, 11:59pm." }] }),
  ts,
);
insAnn.run(
  5002, 202, "No lecture Thursday",
  "<p>I am at a conference Thursday, so <b>lecture is cancelled</b>. Lab sections still meet. Problem Set 6 deadline is unchanged.</p>",
  at(-2, 14), "https://canvas.example.edu/courses/202/discussion_topics/5002",
  JSON.stringify({ isActionable: true, tldr: "Thursday lecture cancelled; labs still meet.", actions: [{ kind: "cancelled_class", date: dateOnly(4), summary: "CHEM 122 lecture cancelled Thursday." }] }),
  ts,
);
insAnn.run(
  5003, 303, "Grades posted for Essay 1",
  "<p>Essay 1 grades and comments are up. Great work overall - see my comments on citations.</p>",
  at(-3, 16), "https://canvas.example.edu/courses/303/discussion_topics/5003",
  JSON.stringify({ isActionable: false, tldr: "Essay 1 grades and feedback are posted.", actions: [] }),
  ts,
);

const insEvt = conn.prepare("INSERT INTO calendar_events(id, title, start_at, end_at, location_name, context_code, synced_at) VALUES(?, ?, ?, ?, ?, ?, ?)");
let eid = 7000;
for (let d = 0; d < 14; d++) {
  const dow = new Date(Date.now() + d * day).getDay();
  if (dow === 1 || dow === 3 || dow === 5) insEvt.run(eid++, "CS 101 Lecture", at(d, 9), at(d, 10, 15), "Gates 100", "course_101", ts);
  if (dow === 2 || dow === 4) insEvt.run(eid++, "CHEM 122 Lecture", at(d, 11), at(d, 12, 15), "Chem 101", "course_202", ts);
  if (dow === 3) insEvt.run(eid++, "CHEM 122 Lab", at(d, 14), at(d, 17), "Chem 220", "course_202", ts);
  if (dow === 2 || dow === 4) insEvt.run(eid++, "ENGL 240 Seminar", at(d, 15), at(d, 16, 15), "Humanities 12", "course_303", ts);
  if (dow === 6) insEvt.run(eid++, "Club soccer", at(d, 10), at(d, 12), "Field 3", "user_4242", ts);
}

createProposal(
  "calendar_update",
  { context_code: "user_4242", assignment_id: 1001, title: "HW3: Recursion due (CS 101)", start_at: at(3, 23, 29), end_at: at(3, 23, 59), description: "Announcement 'HW3 deadline extended': HW3 moved two days later." },
  `Announcement "HW3 deadline extended" in Introduction to Computer Science says the due date for "HW3: Recursion" is now ${new Date(at(3, 23, 59)).toLocaleString("en-US")}. Update your calendar?`,
  "announcement:5001:due_date_change:1001",
);
createProposal(
  "calendar_create",
  { context_code: "user_4242", title: "No class - CHEM 122", start_at: `${dateOnly(4)}T00:00:00`, end_at: `${dateOnly(4)}T00:00:00`, all_day: true, description: "Lecture cancelled." },
  `Announcement "No lecture Thursday" in General Chemistry II: class on ${dateOnly(4)} is cancelled. Mark it on your calendar?`,
  "announcement:5002:cancelled_class",
);
createProposal(
  "calendar_create",
  { context_code: "user_4242", title: "Dr. Priya Nair office hours - CS 101", start_at: at(2, 14), end_at: at(2, 15, 30), location_name: "Gates 214", duplicate: { count: 9, interval: 1, frequency: "weekly" } },
  "The Introduction to Computer Science syllabus lists Dr. Priya Nair's office hours on Tuesday 14:00-15:30 at Gates 214. Add a weekly reminder for the remaining 10 weeks of the term?",
  "syllabus:101:Dr. Priya Nair:2:14:00",
);

console.log("Seeded demo data: 3 courses, 10 assignments, 3 announcements, calendar events, 3 proposals.");
