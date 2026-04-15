import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    exam_id: { type: Number, required: true, min: 1 },
    text: { type: String, required: true, trim: true, minlength: 3 },
    type: { type: String, required: true, enum: ["mcq", "text"] },
    options: {
      type: [String],
      default: [],
      validate: {
        validator(value) {
          if (this.type === "mcq") {
            return Array.isArray(value) && value.length > 0;
          }
          return true;
        },
        message: "Options are required for MCQ questions.",
      },
    },
    correct_answer: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator(value) {
          if (this.type === "mcq") {
            return Boolean(value) && Array.isArray(this.options)
              ? this.options.includes(value)
              : false;
          }
          return true;
        },
        message: "Correct answer must match an MCQ option.",
      },
    },
    order: { type: Number, default: null, min: 1 },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "questions",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

questionSchema.index({ id: 1 }, { unique: true });
questionSchema.index({ exam_id: 1 });

export const Question =
  mongoose.models.Question || mongoose.model("Question", questionSchema);
