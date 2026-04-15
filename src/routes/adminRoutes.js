import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { requireAdmin } from "../middlewares/auth.js";
import {
  createExam,
  createQuestion,
  deleteExam,
  deleteQuestion,
  deleteStudent,
  getDashboardLive,
  getExamQuestions,
  getExams,
  getSessionDetail,
  getSessions,
  getStudents,
  loginAdmin,
  changePassword,
  resetDatabase,
  updateQuestionOrder,
} from "../controllers/adminController.js";
import {
  adminLoginSchema,
  changePasswordSchema,
  examCreateSchema,
  questionCreateSchema,
  questionOrderSchema,
  resetSchema,
} from "../utils/validators.js";

const router = Router();

router.post("/login", validate(adminLoginSchema), loginAdmin);
router.post("/password", requireAdmin, validate(changePasswordSchema), changePassword);

router.get("/dashboard/live", requireAdmin, getDashboardLive);
router.get("/exams", requireAdmin, getExams);
router.post("/exams", requireAdmin, validate(examCreateSchema), createExam);
router.delete("/exams/:id", requireAdmin, deleteExam);
router.get("/exams/:id/questions", requireAdmin, getExamQuestions);
router.put(
  "/exams/:id/questions/order",
  requireAdmin,
  validate(questionOrderSchema),
  updateQuestionOrder
);
router.post(
  "/questions",
  requireAdmin,
  validate(questionCreateSchema),
  createQuestion
);
router.delete("/questions/:id", requireAdmin, deleteQuestion);
router.get("/students", requireAdmin, getStudents);
router.delete("/students/:id", requireAdmin, deleteStudent);
router.get("/sessions", requireAdmin, getSessions);
router.get("/sessions/:sessionId", requireAdmin, getSessionDetail);
router.post("/reset", requireAdmin, validate(resetSchema), resetDatabase);

export default router;
