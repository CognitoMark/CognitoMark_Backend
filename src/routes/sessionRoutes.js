import { Router } from "express";
import { validate } from "../middlewares/validate.js";
import {
  answerSelectionSchema,
  clickFrequencySchema,
  clicksSchema,
  navigationSchema,
  responseSchema,
  stressSchema,
  submitSchema,
  violationSchema,
} from "../utils/validators.js";
import {
  getClickSeries,
  logAnswerSelection,
  logClickFrequency,
  logNavigation,
  logViolation,
  saveResponse,
  submitExam,
  updateClicks,
  updateStress,
} from "../controllers/sessionController.js";

const router = Router();

router.post("/sessions/:sessionId/response", validate(responseSchema), saveResponse);
router.post(
  "/sessions/:sessionId/answer-selection",
  validate(answerSelectionSchema),
  logAnswerSelection
);
router.post("/sessions/:sessionId/clicks", validate(clicksSchema), updateClicks);
router.post(
  "/sessions/:sessionId/click-frequency",
  validate(clickFrequencySchema),
  logClickFrequency
);
router.post(
  "/sessions/:sessionId/navigation",
  validate(navigationSchema),
  logNavigation
);
router.post("/sessions/:sessionId/stress", validate(stressSchema), updateStress);
router.post("/sessions/:sessionId/violation", validate(violationSchema), logViolation);
router.post("/sessions/:sessionId/submit", validate(submitSchema), submitExam);
router.get("/sessions/:sessionId/click-series", getClickSeries);

export default router;
