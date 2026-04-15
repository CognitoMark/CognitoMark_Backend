import mongoose from "mongoose";

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  {
    collection: "counters",
    versionKey: false,
    id: false,
  },
);

export const Counter =
  mongoose.models.Counter || mongoose.model("Counter", counterSchema);
