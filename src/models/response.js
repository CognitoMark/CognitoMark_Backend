import mongoose from "mongoose";

const responseSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    session_id: { type: Number, required: true, min: 1 },
    question_id: { type: Number, required: true, min: 1 },
    answer: { type: String, default: null, trim: true },
    is_correct: { type: Boolean, default: false },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "responses",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

responseSchema.index({ id: 1 }, { unique: true });
responseSchema.index({ session_id: 1, question_id: 1 }, { unique: true });

export const Response =
  mongoose.models.Response || mongoose.model("Response", responseSchema);
