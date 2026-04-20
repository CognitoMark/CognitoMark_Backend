import { createModel } from "../db/modelAdapter.js";

export const Admin = createModel("admins");
export const Student = createModel("students");
export const Exam = createModel("exams");
export const Question = createModel("questions");
export const ExamSession = createModel("exam_sessions");
export const Response = createModel("responses");
export const TelemetryEvent = createModel("telemetry_events");
export const ClickTimeseries = createModel("click_timeseries");
