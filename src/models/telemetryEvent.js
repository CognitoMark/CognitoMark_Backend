import mongoose from "mongoose";

const telemetryEventSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    session_id: { type: Number, required: true, min: 1 },
    question_id: { type: Number, default: null, min: 1 },
    to_question_id: { type: Number, default: null, min: 1 },
    from_question_number: { type: Number, default: null, min: 1 },
    to_question_number: { type: Number, default: null, min: 1 },
    type: { type: String, required: true },
    direction: {
      type: String,
      enum: ["next", "previous"],
      default: null,
    },
    value: { type: String, default: null },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "telemetry_events",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

telemetryEventSchema.index({ id: 1 }, { unique: true });
telemetryEventSchema.index({ session_id: 1 });

export const TelemetryEvent =
  mongoose.models.TelemetryEvent ||
  mongoose.model("TelemetryEvent", telemetryEventSchema);
