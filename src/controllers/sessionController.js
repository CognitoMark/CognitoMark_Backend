import { getNextSequence, setSequenceAtLeast } from "../db/database.js";
import { getIo } from "../sockets/index.js";
import {
  ClickTimeseries,
  ExamSession,
  Question,
  Response,
  TelemetryEvent,
} from "../models/index.js";

const VIOLATION_THRESHOLD = Number(process.env.VIOLATION_THRESHOLD || 3);
const VIOLATION_TYPES = ["TAB_SWITCH", "MINIMIZE", "FULLSCREEN_EXIT"];

const normalizeFeedback = (feedback) => {
  if (typeof feedback !== "string") {
    return null;
  }
  const trimmed = feedback.trim();
  return trimmed.length ? trimmed : null;
};

const examSessions = () => ExamSession;
const responses = () => Response;
const telemetry = () => TelemetryEvent;
const clickTimeseries = () => ClickTimeseries;
const questions = () => Question;

const syncTelemetryCounter = async () => {
  const latest = await telemetry()
    .findOne()
    .sort({ id: -1 })
    .select({ id: 1, _id: 0 })
    .lean();
  const latestId = Number(latest?.id);
  if (Number.isFinite(latestId)) {
    await setSequenceAtLeast("telemetry_events", latestId);
  }
};

const insertTelemetryEvent = async (sessionId, type, value, meta = {}) => {
  const payload = {
    session_id: sessionId,
    type,
    value: JSON.stringify(value),
    created_at: new Date(),
  };

  if (Number.isFinite(meta.questionId)) {
    payload.question_id = meta.questionId;
  }

  if (Number.isFinite(meta.toQuestionId)) {
    payload.to_question_id = meta.toQuestionId;
  }

  if (meta.direction) {
    payload.direction = meta.direction;
  }

  if (Number.isFinite(meta.fromQuestionNumber)) {
    payload.from_question_number = meta.fromQuestionNumber;
  }

  if (Number.isFinite(meta.toQuestionNumber)) {
    payload.to_question_number = meta.toQuestionNumber;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const id = await getNextSequence("telemetry_events");
      await telemetry().create({ id, ...payload });
      return;
    } catch (error) {
      if (error?.code === 11000) {
        await syncTelemetryCounter();
        if (attempt < 5) {
          continue;
        }
      }
      throw error;
    }
  }
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const findSessionById = async (sessionId) =>
  examSessions().findOne({ id: sessionId }).lean();

const emitSubmissionEvent = (sessionId) => {
  getIo().emit("exam_submitted", {
    sessionId: Number(sessionId),
    submittedAt: new Date().toISOString(),
  });
};

const markSessionSubmitted = async (sessionId, feedback) => {
  await examSessions().updateOne(
    { id: sessionId },
    {
      $set: {
        submitted_at: new Date(),
        feedback: normalizeFeedback(feedback),
      },
    },
  );
  emitSubmissionEvent(sessionId);
};

const normalizeAnswer = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
};

const countExamQuestions = (examId) =>
  questions().countDocuments({ exam_id: examId });

const countAnsweredQuestions = (sessionId) =>
  responses().countDocuments({
    session_id: sessionId,
    answer: { $type: "string", $regex: /\S/ },
  });

const countRecordedViolations = (sessionId) =>
  telemetry().countDocuments({
    session_id: sessionId,
    type: { $in: VIOLATION_TYPES },
  });

const getLastClickWindowEnd = (sessionId) =>
  clickTimeseries()
    .find({ session_id: sessionId })
    .sort({ window_end: -1 })
    .limit(1)
    .select({ window_end: 1, _id: 0 })
    .lean();

const isValidDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime());
};

export const saveResponse = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { questionId, answer } = req.body;

    const parsedSessionId = toNumber(sessionId);
    const parsedQuestionId = toNumber(questionId);
    if (!parsedSessionId || !parsedQuestionId) {
      return res.status(400).json({ error: "Invalid session or question id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existingResponse, question] = await Promise.all([
      responses()
        .findOne({ session_id: parsedSessionId, question_id: parsedQuestionId })
        .select({ answer: 1, _id: 0 })
        .lean(),
      questions()
        .findOne({ id: parsedQuestionId })
        .select({ type: 1, _id: 0 })
        .lean(),
    ]);

    const normalizeMcqAnswer = (value) =>
      typeof value === "string" ? value : "";
    const previousAnswer = normalizeMcqAnswer(existingResponse?.answer);
    const nextAnswer = normalizeMcqAnswer(answer);

    const now = new Date();
    const responseId = await getNextSequence("responses");

    try {
      await responses().updateOne(
        { session_id: parsedSessionId, question_id: parsedQuestionId },
        {
          $set: {
            answer,
            updated_at: now,
          },
          $setOnInsert: {
            id: responseId,
            session_id: parsedSessionId,
            question_id: parsedQuestionId,
            created_at: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
      await responses().updateOne(
        { session_id: parsedSessionId, question_id: parsedQuestionId },
        {
          $set: {
            answer,
            updated_at: now,
          },
        },
      );
    }

    await insertTelemetryEvent(parsedSessionId, "answer_saved", {
      questionId: parsedQuestionId,
    });

    if (
      question?.type === "mcq" &&
      previousAnswer &&
      nextAnswer &&
      previousAnswer !== nextAnswer
    ) {
      await insertTelemetryEvent(
        parsedSessionId,
        "ANSWER_SWITCH",
        { from: previousAnswer, to: nextAnswer },
        { questionId: parsedQuestionId },
      );
    }

    getIo().emit("answer_saved", {
      sessionId: Number(parsedSessionId),
      questionId: parsedQuestionId,
      answer,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const logAnswerSelection = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { questionId, answer } = req.body;

    const parsedSessionId = toNumber(sessionId);
    const parsedQuestionId = toNumber(questionId);
    if (!parsedSessionId || !parsedQuestionId) {
      return res.status(400).json({ error: "Invalid session or question id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const question = await questions()
      .findOne({ id: parsedQuestionId })
      .select({ type: 1, _id: 0 })
      .lean();

    if (question?.type === "mcq" && typeof answer === "string") {
      await insertTelemetryEvent(
        parsedSessionId,
        "ANSWER_SELECTED",
        { answer },
        { questionId: parsedQuestionId },
      );
    }

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const updateClicks = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { totalClicks } = req.body;

    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    await examSessions().updateOne(
      { id: parsedSessionId },
      { $set: { total_clicks: totalClicks } },
    );

    await insertTelemetryEvent(parsedSessionId, "click_update", {
      totalClicks,
    });

    getIo().emit("click_update", {
      sessionId: Number(parsedSessionId),
      totalClicks,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const updateStress = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { stressLevel } = req.body;

    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    await examSessions().updateOne(
      { id: parsedSessionId },
      { $set: { stress_level: stressLevel } },
    );

    await insertTelemetryEvent(parsedSessionId, "stress_update", {
      stressLevel,
    });

    getIo().emit("stress_update", {
      sessionId: Number(parsedSessionId),
      stressLevel,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const logClickFrequency = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const {
      windowStart,
      windowEnd,
      questionId,
      headerClicks,
      integrityClicks,
      stressClicks,
      panelClicks,
      stressLevel,
      questionClicks,
      footerClicks,
      otherClicks,
      clickCount,
    } = req.body;

    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (session.submitted_at) {
      return res.json({ success: true, ignored: true, reason: "submitted" });
    }

    if (!isValidDate(windowStart) || !isValidDate(windowEnd)) {
      return res.status(400).json({ error: "Invalid window timestamps" });
    }

    let startDate = new Date(windowStart);
    let endDate = new Date(windowEnd);
    if (endDate <= startDate) {
      endDate = new Date(startDate.getTime() + 1);
    }

    if (clickCount < 0) {
      return res
        .status(400)
        .json({ error: "Click count must be non-negative" });
    }

    const lastWindowRows = await getLastClickWindowEnd(parsedSessionId);
    const lastWindow = lastWindowRows[0];
    if (lastWindow?.window_end && new Date(lastWindow.window_end) > startDate) {
      startDate = new Date(lastWindow.window_end);
      if (endDate <= startDate) {
        endDate = new Date(startDate.getTime() + 1);
      }
    }

    await clickTimeseries().create({
      id: await getNextSequence("click_timeseries"),
      session_id: parsedSessionId,
      window_start: startDate,
      window_end: endDate,
      question_id: questionId ? Number(questionId) : null,
      header_clicks: headerClicks || 0,
      integrity_clicks: integrityClicks || 0,
      stress_clicks: stressClicks || 0,
      panel_clicks: panelClicks || 0,
      stress_level: Number.isFinite(Number(stressLevel))
        ? Number(stressLevel)
        : 0,
      question_clicks: questionClicks || 0,
      footer_clicks: footerClicks || 0,
      other_clicks: otherClicks || 0,
      click_count: clickCount,
      created_at: new Date(),
    });

    await insertTelemetryEvent(parsedSessionId, "click_window", {
      windowStart,
      windowEnd,
      questionId,
      headerClicks,
      integrityClicks,
      stressClicks,
      panelClicks,
      questionClicks,
      footerClicks,
      otherClicks,
      clickCount,
    });

    getIo().emit("click_window", {
      sessionId: Number(parsedSessionId),
      windowStart: startDate.toISOString(),
      windowEnd: endDate.toISOString(),
      questionId,
      clickCount,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const logNavigation = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const {
      fromQuestionId,
      toQuestionId,
      direction,
      fromQuestionNumber,
      toQuestionNumber,
    } = req.body;

    const parsedSessionId = toNumber(sessionId);
    const parsedFromQuestionId = toNumber(fromQuestionId);
    const parsedToQuestionId = toNumber(toQuestionId);
    const parsedFromQuestionNumber = toNumber(fromQuestionNumber);
    const parsedToQuestionNumber = toNumber(toQuestionNumber);

    if (!parsedSessionId || !parsedFromQuestionId || !parsedToQuestionId) {
      return res.status(400).json({ error: "Invalid navigation payload" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (session.submitted_at) {
      return res.json({ success: true, ignored: true, reason: "submitted" });
    }

    await insertTelemetryEvent(
      parsedSessionId,
      "NAVIGATION",
      {
        fromQuestionId: parsedFromQuestionId,
        toQuestionId: parsedToQuestionId,
        direction,
        fromQuestionNumber: parsedFromQuestionNumber,
        toQuestionNumber: parsedToQuestionNumber,
        occurredAt: new Date().toISOString(),
      },
      {
        questionId: parsedFromQuestionId,
        toQuestionId: parsedToQuestionId,
        direction,
        fromQuestionNumber: parsedFromQuestionNumber,
        toQuestionNumber: parsedToQuestionNumber,
      },
    );

    getIo().emit("navigation", {
      sessionId: parsedSessionId,
      fromQuestionId: parsedFromQuestionId,
      toQuestionId: parsedToQuestionId,
      direction,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

export const getClickSeries = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const total = await clickTimeseries().countDocuments({
      session_id: parsedSessionId,
    });

    const items = await clickTimeseries()
      .find({ session_id: parsedSessionId })
      .select({ _id: 0, window_start: 1, window_end: 1, click_count: 1 })
      .sort({ window_start: 1 })
      .lean();

    return res.json({ total, items });
  } catch (error) {
    return next(error);
  }
};

export const submitExam = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { feedback, responses: submittedResponses } = req.body;
    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (session.submitted_at) {
      return res.status(400).json({ error: "Exam already submitted" });
    }

    const totalQuestions = await countExamQuestions(session.exam_id);
    if (!totalQuestions) {
      return res
        .status(400)
        .json({ error: "Exam cannot be submitted without any questions" });
    }

    if (Array.isArray(submittedResponses) && submittedResponses.length > 0) {
      const now = new Date();
      for (const { questionId, answer } of submittedResponses) {
        const parsedQId = Number(questionId);
        if (!parsedQId || typeof answer !== "string") continue;
        
        try {
          const responseId = await getNextSequence("responses");
          await responses().updateOne(
            { session_id: parsedSessionId, question_id: parsedQId },
            {
              $set: { answer, updated_at: now },
              $setOnInsert: {
                id: responseId,
                session_id: parsedSessionId,
                question_id: parsedQId,
                created_at: now,
              },
            },
            { upsert: true }
          );
        } catch (error) {
          if (error?.code !== 11000) throw error;
          await responses().updateOne(
            { session_id: parsedSessionId, question_id: parsedQId },
            { $set: { answer, updated_at: now } }
          );
        }
      }
    }

    const answeredQuestions = await countAnsweredQuestions(parsedSessionId);

    if (answeredQuestions < totalQuestions) {
      return res.status(400).json({
        error: "Please answer all questions before submitting",
        remaining: totalQuestions - answeredQuestions,
      });
    }

    const questionList = await questions()
      .find({ exam_id: session.exam_id })
      .select({ _id: 0, id: 1, type: 1, correct_answer: 1 })
      .lean();

    const responseList = await responses()
      .find({ session_id: parsedSessionId })
      .select({ _id: 0, question_id: 1, answer: 1 })
      .lean();

    const responseMap = responseList.reduce((acc, row) => {
      acc[row.question_id] = row.answer;
      return acc;
    }, {});

    const scoreTotal = questionList.length;
    const correctnessMap = questionList.reduce((acc, question) => {
      const answer = responseMap[question.id];
      let isCorrect = false;
      if (question.correct_answer && answer !== undefined && answer !== null) {
        if (question.type === "text") {
          isCorrect =
            normalizeAnswer(answer) === normalizeAnswer(question.correct_answer);
        } else {
          isCorrect = answer === question.correct_answer;
        }
      }
      acc[question.id] = isCorrect;
      return acc;
    }, {});

    const scoreObtained = Object.values(correctnessMap).reduce(
      (sum, value) => sum + (value ? 1 : 0),
      0,
    );

    const bulkUpdates = responseList.map((row) => ({
      updateOne: {
        filter: { session_id: parsedSessionId, question_id: row.question_id },
        update: { $set: { is_correct: Boolean(correctnessMap[row.question_id]) } },
      },
    }));

    if (bulkUpdates.length) {
      await responses().bulkWrite(bulkUpdates, { ordered: false });
    }

    await examSessions().updateOne(
      { id: parsedSessionId },
      {
        $set: {
          submitted_at: new Date(),
          feedback: normalizeFeedback(feedback),
          score_total: scoreTotal,
          score_obtained: scoreObtained,
        },
      },
    );
    emitSubmissionEvent(parsedSessionId);

    return res.json({
      message: "Exam submitted successfully",
      logout: true,
    });
  } catch (error) {
    return next(error);
  }
};

export const logViolation = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { type, questionId } = req.body;
    const parsedSessionId = toNumber(sessionId);
    if (!parsedSessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const parsedQuestionId = toNumber(questionId);

    const session = await findSessionById(parsedSessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.student_id !== req.student.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (session.submitted_at) {
      const violationCount = await countRecordedViolations(parsedSessionId);
      return res.json({
        message: "Session already submitted",
        violationCount,
        threshold: VIOLATION_THRESHOLD,
        forcedSubmit: false,
      });
    }

    await insertTelemetryEvent(
      parsedSessionId,
      type,
      {
        questionId: parsedQuestionId,
        violationType: type,
        occurredAt: new Date().toISOString(),
      },
      { questionId: parsedQuestionId },
    );

    const violationCount = await countRecordedViolations(parsedSessionId);
    let forcedSubmit = false;

    if (violationCount >= VIOLATION_THRESHOLD) {
      await markSessionSubmitted(parsedSessionId, null);
      forcedSubmit = true;
    }

    return res.json({
      message: forcedSubmit
        ? "Exam auto-submitted due to repeated violations."
        : "Violation logged",
      violationCount,
      threshold: VIOLATION_THRESHOLD,
      forcedSubmit,
    });
  } catch (error) {
    return next(error);
  }
};
