import bcrypt from "bcryptjs";
import { connectDb, getCollection, getNextSequence } from "./database.js";
import {
  Admin,
  ClickTimeseries,
  Counter,
  Exam,
  ExamSession,
  Question,
  Response,
  Student,
  TelemetryEvent,
} from "../models/index.js";

const ensureIndexes = async () => {
  await Promise.all([
    Admin.syncIndexes(),
    Student.syncIndexes(),
    Exam.syncIndexes(),
    Question.syncIndexes(),
    ExamSession.syncIndexes(),
    Response.syncIndexes(),
    TelemetryEvent.syncIndexes(),
    ClickTimeseries.syncIndexes(),
    Counter.syncIndexes(),
  ]);
};

const syncCounter = async (sequenceName, collectionName) => {
  const collection = getCollection(collectionName);
  const counters = getCollection("counters");

  const maxRows = await collection
    .aggregate([
      {
        $project: {
          idNum: {
            $convert: {
              input: "$id",
              to: "long",
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $group: { _id: null, maxId: { $max: "$idNum" } } },
    ])
    .toArray();

  const maxId = maxRows?.[0]?.maxId;
  if (!Number.isFinite(maxId)) {
    return;
  }

  const current = await counters.findOne({ _id: sequenceName });
  const currentSeq = Number.isFinite(current?.seq) ? current.seq : 0;
  if (maxId > currentSeq) {
    await counters.updateOne(
      { _id: sequenceName },
      { $set: { seq: Number(maxId) } },
      { upsert: true },
    );
  }
};

export const initDb = async () => {
  await connectDb();
  await ensureIndexes();

  await Promise.all([
    syncCounter("admins", "admins"),
    syncCounter("students", "students"),
    syncCounter("exams", "exams"),
    syncCounter("questions", "questions"),
    syncCounter("exam_sessions", "exam_sessions"),
    syncCounter("responses", "responses"),
    syncCounter("telemetry_events", "telemetry_events"),
    syncCounter("click_timeseries", "click_timeseries"),
  ]);

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
