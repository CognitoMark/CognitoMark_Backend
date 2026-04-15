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
    const { studentId, name } = req.body;
    let student = await students().findOne(
      { student_id: studentId },
      { _id: 0 },
    ).lean();

    if (!student) {
      const id = await getNextSequence("students");
      student = {
        id,
        student_id: studentId,
        name,
        created_at: new Date(),
      };
      await students().create(student);
    }

    const examsList = await exams()
      .find({}, { _id: 0 })
      .sort({ created_at: -1 })
      .lean();

    getIo().emit("student_created", {
      student,
    });

    return res.json({ student, exams: examsList });
  } catch (error) {
    return next(error);
  }
};

export const startExam = async (req, res, next) => {
  try {
    const { examId } = req.params;
    const { studentId } = req.body;
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

    let questionsList = await questions()
      .find({ exam_id: parsedExamId })
      .select({ _id: 0, correct_answer: 0 })
      .sort({ order: 1, created_at: 1 })
      .lean();

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
