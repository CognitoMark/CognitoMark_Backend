import bcrypt from "bcryptjs";
import { connectDb, getNextSequence, syncAllSequences } from "./database.js";
import { Admin } from "../models/index.js";

export const initDb = async () => {
  await connectDb();
  await syncAllSequences();

  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const adminExists = await Admin.findOne({ username: adminUsername }).lean();

  if (!adminExists) {
    const hash = await bcrypt.hash(adminPassword, 10);
    const id = await getNextSequence("admins");
    await Admin.create({
      id,
      username: adminUsername,
      password_hash: hash,
      created_at: new Date(),
    });
  }
};
