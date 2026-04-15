import mongoose from "mongoose";

const studentSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    student_id: { type: String, required: true, trim: true, minlength: 2 },
    name: { type: String, required: true, trim: true, minlength: 2 },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "students",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

studentSchema.index({ id: 1 }, { unique: true });
studentSchema.index({ student_id: 1 }, { unique: true });

export const Student =
  mongoose.models.Student || mongoose.model("Student", studentSchema);
