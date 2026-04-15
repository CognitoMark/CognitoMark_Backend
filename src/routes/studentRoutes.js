import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import { studentLoginSchema } from "../utils/validators.js";
import { startExam, studentLogin } from "../controllers/studentController.js";

const router = Router();

router.post("/login", validate(studentLoginSchema), studentLogin);
router.post("/exams/:examId/start", startExam);

export default router;
