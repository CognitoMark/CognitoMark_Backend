# Backend Database Reference

This document describes the MongoDB collections used by the backend and the role of each collection.

## Collections

### admins
Stores administrator accounts used to authenticate access to admin-only routes.
These records are read during login and are never exposed directly to students.

Key fields:
- id: Numeric primary key used by the app.
- username: Unique admin login name.
- password_hash: Bcrypt hash of the password.
- created_at: ISO timestamp.

### students
Represents each student identity that logs into the system. This collection
is used to associate human-readable student information with sessions,
telemetry, and reports. It is created/updated at student login and reused
when starting an exam.

Key fields:
- id: Numeric primary key used by the app.
- student_id: Student identifier provided at login (unique).
- name: Student display name.
- created_at: ISO timestamp.

### exams
Defines the exams that appear in the student exam picker and the admin
management pages. Each exam is a parent entity for its questions and
exam sessions.

Key fields:
- id: Numeric primary key used by the app.
- title: Exam title.
- created_at: ISO timestamp.

### questions
Stores the question bank for each exam. Questions are used to render the
student exam UI and to compute completion status when submitting an exam.

Key fields:
- id: Numeric primary key used by the app.
- exam_id: Reference to exams.id.
- text: Question body.
- type: Question type (e.g., mcq, short).
- options: Array of options for multiple-choice questions.
- created_at: ISO timestamp.

### exam_sessions
Represents one attempt by a student on a specific exam. This is the core
entity that ties together responses, telemetry, and click timeseries data.
It also holds summary fields used by the admin dashboard for fast aggregates.

Key fields:
- id: Numeric primary key used by the app.
- student_id: Reference to students.id.
- exam_id: Reference to exams.id.
- started_at: ISO timestamp when the exam started.
- submitted_at: ISO timestamp when the exam was submitted (null if active).
- total_clicks: Aggregate click count for quick stats.
- stress_level: Latest stress level value.
- feedback: Optional text feedback after submission.

### responses
Stores the student's answer for each question in a session. The app updates
this collection as the student types (autosave). It is also used to verify
that all questions are answered before submission and to render admin session
details and exports.

Key fields:
- id: Numeric primary key used by the app.
- session_id: Reference to exam_sessions.id.
- question_id: Reference to questions.id.
- answer: Stored answer value (string).
- updated_at: ISO timestamp of last update.

Notes:
- Unique on (session_id, question_id) to enforce one answer per question per session.

### telemetry_events
Stores a time-ordered stream of events that describe student behavior during
an exam session. The admin dashboard relies on these events for live updates
and integrity monitoring, while the backend uses them to track violations and
system actions (answer saved, stress updates, click windows, etc.).

Key fields:
- id: Numeric primary key used by the app.
- session_id: Reference to exam_sessions.id.
- type: Event type string (e.g., answer_saved, click_update, stress_update, click_window).
- value: JSON string with event payload details.
- created_at: ISO timestamp.

### click_timeseries
Holds windowed click metrics that power the live dashboard and session detail
analytics. Each record captures the click distribution for a time window,
optionally scoped to a question, which allows drilling into behavior over time.

Key fields:
- id: Numeric primary key used by the app.
- session_id: Reference to exam_sessions.id.
- window_start: ISO timestamp of the window start.
- window_end: ISO timestamp of the window end.
- question_id: Reference to questions.id (nullable).
- header_clicks: Count of header clicks in the window.
- integrity_clicks: Count of integrity widget clicks.
- stress_clicks: Count of stress-bar clicks.
- stress_level: Stress value captured for the window.
- question_clicks: Count of clicks in the question area.
- footer_clicks: Count of footer/navigation clicks.
- other_clicks: Count of clicks not mapped to other sections.
- click_count: Total click count in the window.
- created_at: ISO timestamp.

### counters
Internal utility collection used to generate sequential numeric ids for other
collections. This keeps ids compatible with the existing frontend expectations
and API payloads that rely on numeric ids instead of MongoDB ObjectIds.

Key fields:
- _id: Name of the sequence (e.g., "students", "telemetry_events").
- seq: Current numeric value for the sequence.

## Relationships (summary)
- exams -> questions (questions.exam_id)
- students -> exam_sessions (exam_sessions.student_id)
- exams -> exam_sessions (exam_sessions.exam_id)
- exam_sessions -> responses (responses.session_id)
- questions -> responses (responses.question_id)
- exam_sessions -> telemetry_events (telemetry_events.session_id)
- exam_sessions -> click_timeseries (click_timeseries.session_id)
- questions -> click_timeseries (click_timeseries.question_id)
