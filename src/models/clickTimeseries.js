import mongoose from "mongoose";

const clickTimeseriesSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    session_id: { type: Number, required: true, min: 1 },
    question_id: { type: Number, default: null, min: 1 },
    window_start: { type: Date, required: true },
    window_end: { type: Date, required: true },
    header_clicks: { type: Number, default: 0, min: 0 },
    integrity_clicks: { type: Number, default: 0, min: 0 },
    stress_clicks: { type: Number, default: 0, min: 0 },
    panel_clicks: { type: Number, default: 0, min: 0 },
    stress_level: { type: Number, default: 0, min: 0, max: 10 },
    question_clicks: { type: Number, default: 0, min: 0 },
    footer_clicks: { type: Number, default: 0, min: 0 },
    other_clicks: { type: Number, default: 0, min: 0 },
    click_count: { type: Number, required: true, min: 0 },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "click_timeseries",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

clickTimeseriesSchema.index({ id: 1 }, { unique: true });
clickTimeseriesSchema.index({ session_id: 1 });

export const ClickTimeseries =
  mongoose.models.ClickTimeseries ||
  mongoose.model("ClickTimeseries", clickTimeseriesSchema);
