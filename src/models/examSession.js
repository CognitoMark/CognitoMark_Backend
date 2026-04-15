import mongoose from "mongoose";

const examSessionSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    student_id: { type: Number, required: true, min: 1 },
    exam_id: { type: Number, required: true, min: 1 },
    started_at: { type: Date, required: true },
    submitted_at: { type: Date, default: null },
    total_clicks: { type: Number, default: 0, min: 0 },
    stress_level: { type: Number, default: 0, min: 0, max: 10 },
    feedback: { type: String, default: null, trim: true },
    score_total: { type: Number, default: 0, min: 0 },
    score_obtained: { type: Number, default: 0, min: 0 },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "exam_sessions",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

examSessionSchema.index({ id: 1 }, { unique: true });
examSessionSchema.index({ exam_id: 1 });
examSessionSchema.index({ student_id: 1 });

export const ExamSession =
  mongoose.models.ExamSession ||
  mongoose.model("ExamSession", examSessionSchema);
