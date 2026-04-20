import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  getNextSequence,
  listCollectionDocs,
  listSequences,
  resetSequences,
} from "../db/database.js";
import { getIo } from "../sockets/index.js";
import {
  Admin,
  ClickTimeseries,
  Exam,
  ExamSession,
  Question,
  Response,
  Student,
  TelemetryEvent,
} from "../models/index.js";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const admins = () => Admin;
const students = () => Student;
const exams = () => Exam;
const questions = () => Question;
const examSessions = () => ExamSession;
const responses = () => Response;
const telemetry = () => TelemetryEvent;
const clickTimeseries = () => ClickTimeseries;

const VIOLATION_TYPES = ["TAB_SWITCH", "MINIMIZE", "FULLSCREEN_EXIT"];

const EXPORT_COLLECTIONS = Object.freeze([
  "admins",
  "students",
  "exams",
  "questions",
  "exam_sessions",
  "responses",
  "telemetry_events",
  "click_timeseries",
]);

export const loginAdmin = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const admin = await admins().findOne({ username }).lean();

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: admin.id, username }, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });

    return res.json({ token });
  } catch (error) {
    return next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminId = req.admin?.id;

    if (!adminId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const admin = await admins().findOne({ id: adminId }).lean();
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const valid = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!valid) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await admins().updateOne(
      { id: adminId },
      { $set: { password_hash: hash, updated_at: new Date() } }
    );

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const getDashboardLive = async (req, res, next) => {
  try {
    const [activeCount, submittedCount, avgStressRow, avgClicksRow] =
      await Promise.all([
        examSessions().countDocuments({ submitted_at: null }),
        examSessions().countDocuments({ submitted_at: { $ne: null } }),
        examSessions()
          .aggregate([
            { $match: { stress_level: { $gt: 0 } } },
            { $group: { _id: null, avg: { $avg: "$stress_level" } } },
          ])
          .exec(),
        clickTimeseries()
          .aggregate([
            {
              $group: {
                _id: "$session_id",
                total: { $sum: "$click_count" },
              },
            },
            { $group: { _id: null, avg: { $avg: "$total" } } },
          ])
          .exec(),
      ]);

    const sessions = await examSessions()
      .aggregate([
        { $sort: { started_at: -1 } },
        { $limit: 100 },
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "id",
            as: "student",
          },
        },
        {
          $lookup: {
            from: "exams",
            localField: "exam_id",
            foreignField: "id",
            as: "exam",
          },
        },
        {
          $lookup: {
            from: "click_timeseries",
            let: { sessionId: "$id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$session_id", "$$sessionId"] } } },
              { $sort: { window_end: -1 } },
              {
                $group: {
                  _id: null,
                  total_clicks: { $sum: "$click_count" },
                  avg_stress_level: { $avg: "$stress_level" },
                  last_window_clicks: { $first: "$click_count" },
                  last_window_start: { $first: "$window_start" },
                  last_window_end: { $first: "$window_end" },
                },
              },
            ],
            as: "click_stats",
          },
        },
        {
          $lookup: {
            from: "telemetry_events",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $in: ["$type", VIOLATION_TYPES] },
                    ],
                  },
                },
              },
              { $count: "count" },
            ],
            as: "violation_stats",
          },
        },
        {
          $lookup: {
            from: "telemetry_events",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $eq: ["$type", "NAVIGATION"] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  prev_count: {
                    $sum: {
                      $cond: [{ $eq: ["$direction", "previous"] }, 1, 0],
                    },
                  },
                  next_count: {
                    $sum: {
                      $cond: [{ $eq: ["$direction", "next"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            as: "nav_stats",
          },
        },
        {
          $lookup: {
            from: "responses",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$session_id", "$$sessionId"] },
                },
              },
              { $sort: { updated_at: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, answer: 1, question_id: 1 } },
            ],
            as: "latest_response",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { questionId: { $first: "$latest_response.question_id" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$id", "$$questionId"] },
                },
              },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "latest_question",
          },
        },
        {
          $addFields: {
            student: { $first: "$student" },
            exam: { $first: "$exam" },
            click_stats: { $first: "$click_stats" },
            violation_stats: { $first: "$violation_stats" },
            nav_stats: { $first: "$nav_stats" },
            latest_response: { $first: "$latest_response" },
            latest_question: { $first: "$latest_question" },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            started_at: 1,
            submitted_at: 1,
            student_id: "$student.student_id",
            name: "$student.name",
            exam_title: "$exam.title",
            avg_stress_level: { $ifNull: ["$click_stats.avg_stress_level", 0] },
            total_clicks: { $ifNull: ["$click_stats.total_clicks", 0] },
            violation_count: { $ifNull: ["$violation_stats.count", 0] },
            prev_clicks: { $ifNull: ["$nav_stats.prev_count", 0] },
            next_clicks: { $ifNull: ["$nav_stats.next_count", 0] },
            latest_answer: "$latest_response.answer",
            latest_question_text: "$latest_question.text",
            last_window_clicks: {
              $ifNull: ["$click_stats.last_window_clicks", 0],
            },
            last_window_start: "$click_stats.last_window_start",
            last_window_end: "$click_stats.last_window_end",
          },
        },
      ])
      .exec();

    const clickSeries = await clickTimeseries()
      .aggregate([
        { $sort: { window_start: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: "exam_sessions",
            localField: "session_id",
            foreignField: "id",
            as: "session",
          },
        },
        { $addFields: { session: { $first: "$session" } } },
        {
          $lookup: {
            from: "students",
            localField: "session.student_id",
            foreignField: "id",
            as: "student",
          },
        },
        {
          $lookup: {
            from: "exams",
            localField: "session.exam_id",
            foreignField: "id",
            as: "exam",
          },
        },
        {
          $lookup: {
            from: "questions",
            localField: "question_id",
            foreignField: "id",
            as: "question",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { examId: "$session.exam_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$exam_id", "$$examId"] } } },
              { $sort: { order: 1, created_at: 1 } },
              { $project: { _id: 0, id: 1 } },
            ],
            as: "exam_questions",
          },
        },
        {
          $addFields: {
            student: { $first: "$student" },
            exam: { $first: "$exam" },
            question: { $first: "$question" },
            question_number: {
              $let: {
                vars: {
                  questionIds: {
                    $map: {
                      input: "$exam_questions",
                      as: "q",
                      in: "$$q.id",
                    },
                  },
                },
                in: {
                  $let: {
                    vars: {
                      index: {
                        $indexOfArray: ["$$questionIds", "$question_id"],
                      },
                    },
                    in: {
                      $cond: [
                        { $gte: ["$$index", 0] },
                        { $add: ["$$index", 1] },
                        null,
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            session_id: 1,
            window_start: 1,
            window_end: 1,
            click_count: 1,
            question_id: 1,
            question_text: "$question.text",
            question_number: 1,
            student_id: "$student.student_id",
            name: "$student.name",
            exam_title: "$exam.title",
          },
        },
      ])
      .exec();

    const topTransitions = await telemetry()
      .aggregate([
        {
          $match: {
            type: "NAVIGATION",
            question_id: { $ne: null },
            to_question_id: { $ne: null },
          },
        },
        {
          $group: {
            _id: {
              from: "$question_id",
              to: "$to_question_id",
              direction: "$direction",
            },
            count: { $sum: 1 },
            from_question_number: { $first: "$from_question_number" },
            to_question_number: { $first: "$to_question_number" },
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { fromId: "$_id.from" },
            pipeline: [
              { $match: { $expr: { $eq: ["$id", "$$fromId"] } } },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "from_question",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { toId: "$_id.to" },
            pipeline: [
              { $match: { $expr: { $eq: ["$id", "$$toId"] } } },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "to_question",
          },
        },
        {
          $project: {
            _id: 0,
            from_question_id: "$_id.from",
            to_question_id: "$_id.to",
            direction: "$_id.direction",
            count: 1,
            from_question_text: { $first: "$from_question.text" },
            to_question_text: { $first: "$to_question.text" },
            from_question_number: 1,
            to_question_number: 1,
          },
        },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ])
      .exec();

    return res.json({
      metrics: {
        activeStudents: activeCount,
        submittedStudents: submittedCount,
        averageStress: Number(avgStressRow?.[0]?.avg || 0).toFixed(2),
        averageClicks: Number(avgClicksRow?.[0]?.avg || 0).toFixed(2),
      },
      sessions,
      clickSeries,
      topTransitions,
    });
  } catch (error) {
    return next(error);
  }
};

export const getExams = async (req, res, next) => {
  try {
    const items = await exams()
      .find({}, { _id: 0 })
      .sort({ created_at: -1 })
      .lean();
    return res.json(items);
  } catch (error) {
    return next(error);
  }
};

export const createExam = async (req, res, next) => {
  try {
    const { title } = req.body;
    const id = await getNextSequence("exams");
    const exam = {
      id,
      title,
      created_at: new Date(),
    };

    await exams().create(exam);
    getIo().emit("exam_created", { examId: exam.id });
    return res.status(201).json(exam);
  } catch (error) {
    return next(error);
  }
};

export const deleteExam = async (req, res, next) => {
  try {
    const examId = toNumber(req.params.id);
    if (!examId) {
      return res.status(400).json({ error: "Invalid exam id" });
    }

    const existing = await exams().findOne({ id: examId }).lean();
    if (!existing) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const questionIds = await questions()
      .find({ exam_id: examId })
      .select({ id: 1, _id: 0 })
      .lean();
    const questionIdList = questionIds.map((q) => q.id);

    const sessionIds = await examSessions()
      .find({ exam_id: examId })
      .select({ id: 1, _id: 0 })
      .lean();
    const sessionIdList = sessionIds.map((s) => s.id);

    const responseFilters = [];
    if (questionIdList.length) {
      responseFilters.push({ question_id: { $in: questionIdList } });
    }
    if (sessionIdList.length) {
      responseFilters.push({ session_id: { $in: sessionIdList } });
    }

    if (responseFilters.length) {
      await responses().deleteMany({ $or: responseFilters });
    }

    if (sessionIdList.length) {
      await telemetry().deleteMany({ session_id: { $in: sessionIdList } });
      await clickTimeseries().deleteMany({ session_id: { $in: sessionIdList } });
    }

    await examSessions().deleteMany({ exam_id: examId });
    await questions().deleteMany({ exam_id: examId });
    await exams().deleteOne({ id: examId });

    getIo().emit("exam_deleted", { examId });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const getExamQuestions = async (req, res, next) => {
  try {
    const examId = toNumber(req.params.id);
    if (!examId) {
      return res.status(400).json({ error: "Invalid exam id" });
    }
    const items = await questions()
      .find({ exam_id: examId }, { _id: 0 })
      .sort({ order: 1, created_at: 1 })
      .lean();

    if (items.some((q) => !Number.isFinite(q.order))) {
      const resequenced = [...items].sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return aTime - bTime;
      });
      const bulkUpdates = resequenced.map((q, index) => ({
        updateOne: {
          filter: { id: q.id },
          update: { $set: { order: index + 1 } },
        },
      }));
      if (bulkUpdates.length) {
        await questions().bulkWrite(bulkUpdates, { ordered: false });
      }
      const refreshed = await questions()
        .find({ exam_id: examId }, { _id: 0 })
        .sort({ order: 1, created_at: 1 })
        .lean();
      return res.json(refreshed.map((q) => ({ ...q, options: q.options || [] })));
    }
    return res.json(items.map((q) => ({ ...q, options: q.options || [] })));
  } catch (error) {
    return next(error);
  }
};

export const createQuestion = async (req, res, next) => {
  try {
    const { examId, text, type, options, correctAnswer } = req.body;
    const id = await getNextSequence("questions");
    const trimmedCorrect =
      typeof correctAnswer === "string" ? correctAnswer.trim() : "";
    if (type === "mcq") {
      if (!trimmedCorrect) {
        return res
          .status(400)
          .json({ error: "Correct answer is required for MCQ questions" });
      }
      if (!Array.isArray(options) || !options.includes(trimmedCorrect)) {
        return res.status(400).json({
          error: "Correct answer must match one of the MCQ options",
        });
      }
    }
    const lastOrderRow = await questions()
      .find({ exam_id: Number(examId) })
      .sort({ order: -1, created_at: -1 })
      .limit(1)
      .select({ order: 1, _id: 0 })
      .lean();
    const lastOrder = lastOrderRow?.[0]?.order;
    const fallbackCount = await questions().countDocuments({
      exam_id: Number(examId),
    });
    const nextOrder = (Number.isFinite(lastOrder) ? lastOrder : fallbackCount) + 1;

    const question = {
      id,
      exam_id: Number(examId),
      text,
      type,
      options: Array.isArray(options) ? options : [],
      correct_answer: trimmedCorrect || null,
      order: nextOrder,
      created_at: new Date(),
    };

    await questions().create(question);
    getIo().emit("question_created", {
      questionId: question.id,
      examId: question.exam_id,
    });
    return res.status(201).json(question);
  } catch (error) {
    return next(error);
  }
};

export const deleteQuestion = async (req, res, next) => {
  try {
    const questionId = toNumber(req.params.id);
    if (!questionId) {
      return res.status(400).json({ error: "Invalid question id" });
    }

    const existing = await questions().findOne({ id: questionId }).lean();
    if (!existing) {
      return res.status(404).json({ error: "Question not found" });
    }

    const result = await questions().deleteOne({ id: questionId });
    if (!result.deletedCount) {
      return res.status(404).json({ error: "Question not found" });
    }

    await responses().deleteMany({ question_id: questionId });
    await clickTimeseries().deleteMany({ question_id: questionId });

    const remaining = await questions()
      .find({ exam_id: existing.exam_id })
      .sort({ order: 1, created_at: 1 })
      .select({ id: 1, _id: 0 })
      .lean();
    if (remaining.length) {
      const bulkUpdates = remaining.map((q, index) => ({
        updateOne: {
          filter: { id: q.id },
          update: { $set: { order: index + 1 } },
        },
      }));
      await questions().bulkWrite(bulkUpdates, { ordered: false });
    }

    getIo().emit("question_deleted", { questionId, examId: existing.exam_id });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const updateQuestionOrder = async (req, res, next) => {
  try {
    const examId = toNumber(req.params.id);
    if (!examId) {
      return res.status(400).json({ error: "Invalid exam id" });
    }

    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "Invalid question order" });
    }

    const existing = await questions()
      .find({ exam_id: examId })
      .select({ id: 1, _id: 0 })
      .lean();
    const existingIds = new Set(existing.map((q) => q.id));
    const validIds = orderedIds.filter((id) => existingIds.has(id));

    if (validIds.length !== existing.length) {
      return res.status(400).json({ error: "Question order does not match exam" });
    }

    const bulkUpdates = validIds.map((id, index) => ({
      updateOne: {
        filter: { id },
        update: { $set: { order: index + 1 } },
      },
    }));

    await questions().bulkWrite(bulkUpdates, { ordered: false });
    getIo().emit("question_reordered", { examId });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const getStudents = async (req, res, next) => {
  try {
    const items = await students()
      .find({}, { _id: 0 })
      .sort({ created_at: -1 })
      .lean();
    return res.json(items);
  } catch (error) {
    return next(error);
  }
};

export const deleteStudent = async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const parsedId = toNumber(rawId);
    const student = parsedId
      ? await students().findOne({ id: parsedId }).lean()
      : await students().findOne({ student_id: rawId }).lean();

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const sessionIds = await examSessions()
      .find({ student_id: student.id })
      .select({ id: 1, _id: 0 })
      .lean();
    const sessionIdList = sessionIds.map((s) => s.id);

    if (sessionIdList.length) {
      await responses().deleteMany({ session_id: { $in: sessionIdList } });
      await telemetry().deleteMany({ session_id: { $in: sessionIdList } });
      await clickTimeseries().deleteMany({ session_id: { $in: sessionIdList } });
    }

    await examSessions().deleteMany({ student_id: student.id });
    await students().deleteOne({ id: student.id });

    getIo().emit("student_deleted", { studentId: rawId });
    getIo().emit("session_deleted"); // Notify sessions list to refresh

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const resetDatabase = async (req, res, next) => {
  try {
    const { password } = req.body;
    const adminId = req.admin?.id;
    if (!adminId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const admin = await admins().findOne({ id: adminId }).lean();
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    await Promise.all([
      students().deleteMany({}),
      examSessions().deleteMany({}),
      responses().deleteMany({}),
      telemetry().deleteMany({}),
      clickTimeseries().deleteMany({}),
    ]);

    await resetSequences([
      "students",
      "exam_sessions",
      "responses",
      "telemetry_events",
      "click_timeseries",
    ]);

    getIo().emit("reset");
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const exportDatabase = async (req, res, next) => {
  try {
    const collections = Object.fromEntries(
      EXPORT_COLLECTIONS.map((name) => [name, listCollectionDocs(name)]),
    );

    const payload = {
      exported_at: new Date().toISOString(),
      counts: Object.fromEntries(
        Object.entries(collections).map(([name, docs]) => [name, docs.length]),
      ),
      counters: listSequences(),
      collections,
    };

    const filenameTimestamp = payload.exported_at.replace(/[.:]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cognitomark-backup-${filenameTimestamp}.json"`,
    );

    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return next(error);
  }
};

export const getSessions = async (req, res, next) => {
  try {
    const items = await examSessions()
      .aggregate([
        { $sort: { started_at: -1 } },
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "id",
            as: "student",
          },
        },
        {
          $lookup: {
            from: "exams",
            localField: "exam_id",
            foreignField: "id",
            as: "exam",
          },
        },
        {
          $lookup: {
            from: "click_timeseries",
            let: { sessionId: "$id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$session_id", "$$sessionId"] } } },
              {
                $group: {
                  _id: null,
                  total_clicks: { $sum: "$click_count" },
                  header_clicks: { $sum: "$header_clicks" },
                  stress_clicks: { $sum: "$stress_clicks" },
                  question_clicks: { $sum: "$question_clicks" },
                  navigation_clicks: { $sum: "$footer_clicks" },
                  other_clicks: { $sum: "$other_clicks" },
                  avg_stress_level: { $avg: "$stress_level" },
                },
              },
            ],
            as: "click_stats",
          },
        },
        {
          $lookup: {
            from: "telemetry_events",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $in: ["$type", VIOLATION_TYPES] },
                    ],
                  },
                },
              },
              { $count: "count" },
            ],
            as: "violation_stats",
          },
        },
        {
          $lookup: {
            from: "telemetry_events",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $eq: ["$type", "NAVIGATION"] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  prev_count: {
                    $sum: {
                      $cond: [{ $eq: ["$direction", "previous"] }, 1, 0],
                    },
                  },
                  next_count: {
                    $sum: {
                      $cond: [{ $eq: ["$direction", "next"] }, 1, 0],
                    },
                  },
                },
              },
            ],
            as: "nav_stats",
          },
        },
        {
          $lookup: {
            from: "responses",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$session_id", "$$sessionId"] },
                },
              },
              { $sort: { updated_at: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, answer: 1, question_id: 1 } },
            ],
            as: "latest_response",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { questionId: { $first: "$latest_response.question_id" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$id", "$$questionId"] },
                },
              },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "latest_question",
          },
        },
        {
          $addFields: {
            student: { $first: "$student" },
            exam: { $first: "$exam" },
            click_stats: { $first: "$click_stats" },
            violation_stats: { $first: "$violation_stats" },
            nav_stats: { $first: "$nav_stats" },
            latest_response: { $first: "$latest_response" },
            latest_question: { $first: "$latest_question" },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            student_id: "$student.student_id",
            name: "$student.name",
            exam_title: "$exam.title",
            total_clicks: { $ifNull: ["$click_stats.total_clicks", 0] },
            header_clicks: { $ifNull: ["$click_stats.header_clicks", 0] },
            stress_clicks: { $ifNull: ["$click_stats.stress_clicks", 0] },
            question_clicks: { $ifNull: ["$click_stats.question_clicks", 0] },
            navigation_clicks: {
              $ifNull: ["$click_stats.navigation_clicks", 0],
            },
            other_clicks: { $ifNull: ["$click_stats.other_clicks", 0] },
            avg_stress_level: { $ifNull: ["$click_stats.avg_stress_level", 0] },
            violation_count: { $ifNull: ["$violation_stats.count", 0] },
            prev_clicks: { $ifNull: ["$nav_stats.prev_count", 0] },
            next_clicks: { $ifNull: ["$nav_stats.next_count", 0] },
            latest_answer: "$latest_response.answer",
            latest_question_text: "$latest_question.text",
            stress_level: 1,
            started_at: 1,
            submitted_at: 1,
          },
        },
      ])
      .exec();

    return res.json(items);
  } catch (error) {
    return next(error);
  }
};

const fetchDetailForSession = async (sessionId) => {
    const sessionRows = await examSessions()
      .aggregate([
        { $match: { id: sessionId } },
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "id",
            as: "student",
          },
        },
        {
          $lookup: {
            from: "exams",
            localField: "exam_id",
            foreignField: "id",
            as: "exam",
          },
        },
        {
          $lookup: {
            from: "click_timeseries",
            let: { sessionId: "$id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$session_id", "$$sessionId"] } } },
              {
                $group: {
                  _id: null,
                  total_clicks: { $sum: "$click_count" },
                  avg_stress_level: { $avg: "$stress_level" },
                },
              },
            ],
            as: "click_stats",
          },
        },
        {
          $lookup: {
            from: "telemetry_events",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $in: ["$type", VIOLATION_TYPES] },
                    ],
                  },
                },
              },
              { $count: "count" },
            ],
            as: "violation_stats",
          },
        },
        {
          $lookup: {
            from: "responses",
            let: { sessionId: "$id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$session_id", "$$sessionId"] },
                },
              },
              { $sort: { updated_at: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, answer: 1, question_id: 1 } },
            ],
            as: "latest_response",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { questionId: { $first: "$latest_response.question_id" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$id", "$$questionId"] },
                },
              },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "latest_question",
          },
        },
        {
          $addFields: {
            student: { $first: "$student" },
            exam: { $first: "$exam" },
            click_stats: { $first: "$click_stats" },
            violation_stats: { $first: "$violation_stats" },
            latest_response: { $first: "$latest_response" },
            latest_question: { $first: "$latest_question" },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            student_id: "$student.student_id",
            exam_id: 1,
            started_at: 1,
            submitted_at: 1,
            total_clicks: { $ifNull: ["$click_stats.total_clicks", 0] },
            avg_stress_level: { $ifNull: ["$click_stats.avg_stress_level", 0] },
            violation_count: { $ifNull: ["$violation_stats.count", 0] },
            name: "$student.name",
            exam_title: "$exam.title",
            stress_level: 1,
            feedback: 1,
            latest_answer: "$latest_response.answer",
            latest_question_text: "$latest_question.text",
              score_total: 1,
              score_obtained: 1,
          },
        },
      ])
      .exec();

    const session = sessionRows[0];
    if (!session) {
      return null;
    }

    const responsesList = await responses()
      .aggregate([
        { $match: { session_id: sessionId } },
        {
          $lookup: {
            from: "questions",
            localField: "question_id",
            foreignField: "id",
            as: "question",
          },
        },
        { $addFields: { question: { $first: "$question" } } },
        {
          $lookup: {
            from: "click_timeseries",
            let: {
              sessionId: "$session_id",
              questionId: "$question_id",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$session_id", "$$sessionId"] },
                      { $eq: ["$question_id", "$$questionId"] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  click_count: { $sum: "$click_count" },
                  header_clicks: { $sum: "$header_clicks" },
                  integrity_clicks: { $sum: "$integrity_clicks" },
                  stress_clicks: { $sum: "$stress_clicks" },
                  panel_clicks: { $sum: "$panel_clicks" },
                  avg_stress_level: { $avg: "$stress_level" },
                  question_clicks: { $sum: "$question_clicks" },
                  footer_clicks: { $sum: "$footer_clicks" },
                  other_clicks: { $sum: "$other_clicks" },
                },
              },
            ],
            as: "click_stats",
          },
        },
        { $addFields: { click_stats: { $first: "$click_stats" } } },
        {
          $project: {
            _id: 0,
            id: 1,
            session_id: 1,
            question_id: 1,
            answer: 1,
            is_correct: 1,
            created_at: 1,
            updated_at: 1,
            text: "$question.text",
            type: "$question.type",
            options: "$question.options",
            correct_answer: "$question.correct_answer",
            click_count: { $ifNull: ["$click_stats.click_count", 0] },
            header_clicks: { $ifNull: ["$click_stats.header_clicks", 0] },
            integrity_clicks: {
              $ifNull: ["$click_stats.integrity_clicks", 0],
            },
            stress_clicks: { $ifNull: ["$click_stats.stress_clicks", 0] },
            panel_clicks: { $ifNull: ["$click_stats.panel_clicks", 0] },
            avg_stress_level: {
              $ifNull: ["$click_stats.avg_stress_level", 0],
            },
            question_clicks: { $ifNull: ["$click_stats.question_clicks", 0] },
            footer_clicks: { $ifNull: ["$click_stats.footer_clicks", 0] },
            other_clicks: { $ifNull: ["$click_stats.other_clicks", 0] },
          },
        },
      ])
      .exec();

    const totalQuestions = await questions().countDocuments({
      exam_id: session.exam_id,
    });

    const normalizeAnswer = (value) =>
      typeof value === "string" ? value.trim().toLowerCase() : "";

    const scoredResponses = responsesList.map((r) => {
      if (typeof r.is_correct === "boolean") {
        return r;
      }
      let isCorrect = false;
      if (r.correct_answer && r.answer !== undefined && r.answer !== null) {
        if (r.type === "text") {
          isCorrect =
            normalizeAnswer(r.answer) === normalizeAnswer(r.correct_answer);
        } else {
          isCorrect = r.answer === r.correct_answer;
        }
      }
      return { ...r, is_correct: isCorrect };
    });

    const computedScore = scoredResponses.reduce(
      (sum, r) => sum + (r.is_correct ? 1 : 0),
      0,
    );

    const navRows = await telemetry()
      .aggregate([
        {
          $match: {
            session_id: sessionId,
            type: "NAVIGATION",
            question_id: { $ne: null },
            to_question_id: { $ne: null },
          },
        },
        {
          $group: {
            _id: { question_id: "$question_id", direction: "$direction" },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const navigationCounts = navRows.reduce((acc, row) => {
      const questionId = row._id?.question_id;
      if (!Number.isFinite(questionId)) {
        return acc;
      }
      if (!acc[questionId]) {
        acc[questionId] = { prev: 0, next: 0 };
      }
      if (row._id.direction === "previous") {
        acc[questionId].prev = row.count;
      } else if (row._id.direction === "next") {
        acc[questionId].next = row.count;
      }
      return acc;
    }, {});

    const navigationTransitions = await telemetry()
      .aggregate([
        {
          $match: {
            session_id: sessionId,
            type: "NAVIGATION",
            question_id: { $ne: null },
            to_question_id: { $ne: null },
          },
        },
        {
          $group: {
            _id: {
              from: "$question_id",
              to: "$to_question_id",
              direction: "$direction",
            },
            count: { $sum: 1 },
            from_question_number: { $first: "$from_question_number" },
            to_question_number: { $first: "$to_question_number" },
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { fromId: "$_id.from" },
            pipeline: [
              { $match: { $expr: { $eq: ["$id", "$$fromId"] } } },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "from_question",
          },
        },
        {
          $lookup: {
            from: "questions",
            let: { toId: "$_id.to" },
            pipeline: [
              { $match: { $expr: { $eq: ["$id", "$$toId"] } } },
              { $project: { _id: 0, text: 1 } },
            ],
            as: "to_question",
          },
        },
        {
          $project: {
            _id: 0,
            from_question_id: "$_id.from",
            to_question_id: "$_id.to",
            direction: "$_id.direction",
            count: 1,
            from_question_text: { $first: "$from_question.text" },
            to_question_text: { $first: "$to_question.text" },
            from_question_number: 1,
            to_question_number: 1,
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec();

    const answerSwitchEvents = await telemetry()
      .find({ session_id: sessionId, type: "ANSWER_SWITCH" })
      .select({ _id: 0, question_id: 1, value: 1, created_at: 1 })
      .sort({ created_at: 1 })
      .lean();

    const answerSelectionEvents = await telemetry()
      .find({ session_id: sessionId, type: "ANSWER_SELECTED" })
      .select({ _id: 0, question_id: 1, value: 1, created_at: 1 })
      .sort({ created_at: 1 })
      .lean();

    const answerSwitchesByQuestion = answerSwitchEvents.reduce((acc, event) => {
      const questionId = event.question_id;
      if (!Number.isFinite(questionId)) {
        return acc;
      }
      let payload = null;
      if (event.value) {
        try {
          payload = JSON.parse(event.value);
        } catch {
          payload = null;
        }
      }
      const from = typeof payload?.from === "string" ? payload.from : null;
      const to = typeof payload?.to === "string" ? payload.to : null;
      if (!from || !to) {
        return acc;
      }
      if (!acc[questionId]) {
        acc[questionId] = [];
      }
      acc[questionId].push({ from, to, at: event.created_at || null });
      return acc;
    }, {});

    const answerSelectionsByQuestion = answerSelectionEvents.reduce(
      (acc, event) => {
        const questionId = event.question_id;
        if (!Number.isFinite(questionId)) {
          return acc;
        }
        let payload = null;
        if (event.value) {
          try {
            payload = JSON.parse(event.value);
          } catch {
            payload = null;
          }
        }
        const answer =
          typeof payload?.answer === "string" ? payload.answer : null;
        if (!answer) {
          return acc;
        }
        if (!acc[questionId]) {
          acc[questionId] = [];
        }
        acc[questionId].push({ answer, at: event.created_at || null });
        return acc;
      },
      {},
    );

    const derivedSwitchesByQuestion = Object.entries(
      answerSelectionsByQuestion,
    ).reduce((acc, [questionId, selections]) => {
      let lastAnswer = null;
      const switches = [];
      selections.forEach((entry) => {
        const currentAnswer = entry.answer;
        if (lastAnswer !== null && currentAnswer !== lastAnswer) {
          switches.push({
            from: lastAnswer,
            to: currentAnswer,
            at: entry.at || null,
          });
        }
        lastAnswer = currentAnswer;
      });
      if (switches.length) {
        acc[questionId] = switches;
      }
      return acc;
    }, {});

    const violations = await telemetry()
      .find({ session_id: sessionId, type: { $in: VIOLATION_TYPES } })
      .select({ _id: 0, question_id: 1, created_at: 1, value: 1 })
      .lean();

    const clickWindows = await clickTimeseries()
      .aggregate([
        { $match: { session_id: sessionId } },
        {
          $lookup: {
            from: "questions",
            localField: "question_id",
            foreignField: "id",
            as: "question",
          },
        },
        { $addFields: { question: { $first: "$question" } } },
        {
          $project: {
            _id: 0,
            id: 1,
            question_id: 1,
            question_text: "$question.text",
            window_start: 1,
            window_end: 1,
            click_count: 1,
            header_clicks: 1,
            integrity_clicks: 1,
            stress_clicks: 1,
            panel_clicks: 1,
            question_clicks: 1,
            footer_clicks: 1,
            other_clicks: 1,
            stress_level: 1,
            created_at: 1,
          },
        },
        { $sort: { window_start: 1, id: 1 } },
      ])
      .exec();

    const telemetryEvents = await telemetry()
      .aggregate([
        { $match: { session_id: sessionId } },
        {
          $lookup: {
            from: "questions",
            localField: "question_id",
            foreignField: "id",
            as: "question",
          },
        },
        {
          $lookup: {
            from: "questions",
            localField: "to_question_id",
            foreignField: "id",
            as: "to_question",
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            session_id: 1,
            question_id: 1,
            question_text: { $first: "$question.text" },
            to_question_id: 1,
            to_question_text: { $first: "$to_question.text" },
            from_question_number: 1,
            to_question_number: 1,
            direction: 1,
            type: 1,
            created_at: 1,
            updated_at: 1,
            value: 1,
          },
        },
        { $sort: { created_at: 1, id: 1 } },
      ])
      .exec();

    const resolveViolationQuestionId = (violation) => {
      if (Number.isFinite(violation.question_id)) {
        return violation.question_id;
      }

      if (violation.value) {
        try {
          const parsed = JSON.parse(violation.value);
          if (Number.isFinite(Number(parsed?.questionId))) {
            return Number(parsed.questionId);
          }
        } catch {
          // ignore invalid JSON
        }
      }

      if (!violation.created_at) {
        return null;
      }

      const eventTime = new Date(violation.created_at).getTime();
      if (!Number.isFinite(eventTime)) {
        return null;
      }

      const match = clickWindows.find((window) => {
        const start = new Date(window.window_start).getTime();
        const end = new Date(window.window_end).getTime();
        return Number.isFinite(start) && Number.isFinite(end)
          ? eventTime >= start && eventTime <= end
          : false;
      });

      return match?.question_id ?? null;
    };

    const violationCounts = violations.reduce((acc, violation) => {
      const questionId = resolveViolationQuestionId(violation);
      if (Number.isFinite(questionId)) {
        acc[questionId] = (acc[questionId] || 0) + 1;
      }
      return acc;
    }, {});

    const scoreTotal = Number.isFinite(session.score_total)
      ? session.score_total
      : totalQuestions;
    const scoreObtained = Number.isFinite(session.score_obtained)
      ? session.score_obtained
      : computedScore;

    return {
      session: {
        ...session,
        score_total: scoreTotal,
        score_obtained: scoreObtained,
      },
      responses: scoredResponses.map((r) => ({
        ...r,
        prev_clicks: navigationCounts[r.question_id]?.prev || 0,
        next_clicks: navigationCounts[r.question_id]?.next || 0,
        violation_count: violationCounts[r.question_id] || 0,
        options: r.options || [],
        answer_selections: answerSelectionsByQuestion[r.question_id] || [],
        answer_switches:
          derivedSwitchesByQuestion[r.question_id] ||
          answerSwitchesByQuestion[r.question_id] ||
          [],
        total_switches:
          derivedSwitchesByQuestion[r.question_id]?.length ||
          answerSwitchesByQuestion[r.question_id]?.length ||
          0,
      })),
      clickWindows,
      navigationTransitions,
      telemetryEvents,
    };
};

export const getSessionDetail = async (req, res, next) => {
  try {
    const sessionId = toNumber(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }
    const detail = await fetchDetailForSession(sessionId);
    if (!detail) {
      return res.status(404).json({ error: "Session not found" });
    }
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
};

export const getSessionsDetailsBulk = async (req, res, next) => {
  try {
    const { sessionIds } = req.body;
    if (!Array.isArray(sessionIds)) {
      return res.status(400).json({ error: "Invalid sessionIds array" });
    }
    const results = [];
    for (const id of sessionIds) {
      const parsedId = toNumber(id);
      if (parsedId) {
        const detail = await fetchDetailForSession(parsedId);
        if (detail) {
          results.push(detail);
        }
      }
    }
    return res.json({ details: results });
  } catch (error) {
    return next(error);
  }
};
