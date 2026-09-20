// Subset of Canvas API object shapes that this app reads.

export interface CanvasUser {
  id: number;
  name: string;
  short_name?: string;
  email?: string;
  login_id?: string;
}

export interface CanvasTerm {
  id: number;
  name: string;
  start_at: string | null;
  end_at: string | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state: string;
  syllabus_body?: string | null;
  term?: CanvasTerm;
  start_at?: string | null;
  end_at?: string | null;
  access_restricted_by_date?: boolean;
  /** Present with include[]=favorites. True if the student starred the course in Canvas. */
  is_favorite?: boolean;
}

export interface CanvasTab {
  id: string;
  label: string;
  hidden?: boolean;
  visibility?: string;
}

export interface CanvasSubmission {
  id: number;
  assignment_id: number;
  workflow_state: "submitted" | "unsubmitted" | "graded" | "pending_review";
  submitted_at: string | null;
  score: number | null;
  grade: string | null;
  missing?: boolean;
  late?: boolean;
  excused?: boolean;
}

export interface CanvasAssignment {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible: number | null;
  submission_types: string[];
  html_url: string;
  published?: boolean;
  submission?: CanvasSubmission;
  assignment_group_id?: number;
  course?: CanvasCourse; // present on missing_submissions with include[]=course
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message: string; // HTML
  posted_at: string | null;
  context_code: string; // "course_123"
  html_url: string;
  author?: { display_name?: string };
}

export interface CanvasCalendarEvent {
  id: number;
  title: string;
  description?: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day?: boolean;
  location_name?: string | null;
  context_code: string;
  html_url?: string;
  workflow_state?: string;
  type?: "event" | "assignment";
}

export interface CanvasEnrollmentUser extends CanvasUser {
  enrollments?: Array<{ type: string; role: string }>;
}

export interface CanvasConversation {
  id: number;
  subject: string;
}
