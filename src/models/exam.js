import mongoose from "mongoose";

const examSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, minlength: 3 },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "exams",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

examSchema.index({ id: 1 }, { unique: true });

export const Exam = mongoose.models.Exam || mongoose.model("Exam", examSchema);
