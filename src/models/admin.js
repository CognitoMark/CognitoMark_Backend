import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, min: 1 },
    username: { type: String, required: true, trim: true, minlength: 2 },
    password_hash: { type: String, required: true },
    created_at: { type: Date },
    updated_at: { type: Date },
  },
  {
    collection: "admins",
    versionKey: false,
    id: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

adminSchema.index({ id: 1 }, { unique: true });
adminSchema.index({ username: 1 }, { unique: true });

export const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);
