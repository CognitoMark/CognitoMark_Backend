import jwt from "jsonwebtoken";
import { getNextSequence } from "../db/database.js";
import { getIo } from "../sockets/index.js";
import { Exam, ExamSession, Question, Student } from "../models/index.js";

const students = () => Student;
const exams = () => Exam;
const questions = () => Question;
const examSessions = () => ExamSession;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const studentLogin = async (req, res, next) => {
  try {
    const rawStudentId = req.body.studentId;
    const name = req.body.name;
    const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : rawStudentId;

    let student = await students().findOne(
      { student_id: studentId },
      { _id: 0 },
    ).lean();

    if (student) {
      return res.status(400).json({ error: "User already exist" });
    } else {
      const id = await getNextSequence("students");
      student = {
        id,
        student_id: studentId,
        name,
        created_at: new Date(),
      };
      await students().create(student);

      // Only emit student_created when a NEW student is actually created
      getIo().emit("student_created", {
        student,
      });
    }

    const examsList = await exams()
      .find({}, { _id: 0 })
      .sort({ created_at: -1 })
      .lean();

    // Generate Student JWT Token
    const token = jwt.sign(
      { id: student.id, student_id: student.student_id, role: "student" },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.json({ student, exams: examsList, token });
  } catch (error) {
    return next(error);
  }
};

export const startExam = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const rawStudentId = req.body.studentId;
    const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : rawStudentId;

    const parsedExamId = toNumber(examId);
    if (!parsedExamId) {
      return res.status(400).json({ error: "Invalid exam id" });
    }

    const student = await students().findOne(
      { student_id: studentId },
      { _id: 0 },
    ).lean();

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const exam = await exams().findOne(
      { id: parsedExamId },
      { _id: 0 },
    ).lean();
    if (!exam) {
      return res.status(404).json({ error: "Exam not found" });
    }

    // Check for existing active session for this student and exam
    const existingSession = await examSessions().findOne({
      student_id: student.id,
      exam_id: parsedExamId,
      submitted_at: null,
    }).lean();

    let questionsList = await questions()
      .find({ exam_id: parsedExamId })
      .select({ _id: 0, correct_answer: 0 })
      .sort({ order: 1, created_at: 1 })
      .lean();

    if (existingSession) {
      return res.json({
        session: existingSession,
        exam,
        questions: questionsList.map((q) => ({
          ...q,
          options: q.options || [],
        })),
      });
    }

    const session = {
      id: await getNextSequence("exam_sessions"),
      student_id: student.id,
      exam_id: parsedExamId,
      started_at: new Date(),
      submitted_at: null,
      total_clicks: 0,
      stress_level: 0,
      feedback: null,
    };

    await examSessions().create(session);

    if (questionsList.some((q) => !Number.isFinite(q.order))) {
      const resequenced = [...questionsList].sort((a, b) => {
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
      questionsList = await questions()
        .find({ exam_id: parsedExamId })
        .select({ _id: 0, correct_answer: 0 })
        .sort({ order: 1, created_at: 1 })
        .lean();
    }

    getIo().emit("student_started", {
      sessionId: session.id,
      studentId: student.student_id,
      studentName: student.name,
      examTitle: exam.title,
      startedAt: session.started_at,
    });

    return res.json({
      session,
      exam,
      questions: questionsList.map((q) => ({
        ...q,
        options: q.options || [],
      })),
    });
  } catch (error) {
    return next(error);
  }
};
