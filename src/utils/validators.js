import { z } from "zod";

export const adminLoginSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(4),
});

export const studentLoginSchema = z.object({
  studentId: z.string().min(2),
  name: z.string().min(2),
});

export const examCreateSchema = z.object({
  title: z.string().min(3),
});

export const questionCreateSchema = z.object({
  examId: z.number().int(),
  text: z.string().min(3),
  type: z.enum(["mcq", "text"]),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().min(1).optional(),
});

export const questionOrderSchema = z.object({
  orderedIds: z.array(z.number().int()).min(1),
});

export const responseSchema = z.object({
  questionId: z.number().int(),
  answer: z.string().optional(),
});

export const answerSelectionSchema = z.object({
  questionId: z.number().int(),
  answer: z.string(),
});

export const clicksSchema = z.object({
  totalClicks: z.number().int().nonnegative(),
});

export const clickFrequencySchema = z.object({
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  questionId: z.number().int().optional(),
  headerClicks: z.number().int().nonnegative().optional(),
  integrityClicks: z.number().int().nonnegative().optional(),
  stressClicks: z.number().int().nonnegative().optional(),
  panelClicks: z.number().int().nonnegative().optional(),
  stressLevel: z.number().int().min(0).max(10).optional(),
  questionClicks: z.number().int().nonnegative().optional(),
  footerClicks: z.number().int().nonnegative().optional(),
  otherClicks: z.number().int().nonnegative().optional(),
  clickCount: z.number().int().nonnegative(),
});

export const stressSchema = z.object({
  stressLevel: z.number().int().min(0).max(10),
});

export const submitSchema = z.object({
  feedback: z.string().optional(),
});

export const violationSchema = z.object({
  type: z.enum(["TAB_SWITCH", "MINIMIZE", "FULLSCREEN_EXIT"]),
});

export const navigationSchema = z.object({
  fromQuestionId: z.number().int(),
  toQuestionId: z.number().int(),
  direction: z.enum(["next", "previous"]),
  fromQuestionNumber: z.number().int().min(1).optional(),
  toQuestionNumber: z.number().int().min(1).optional(),
});

export const resetSchema = z.object({
  password: z.string().min(4),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(4),
  newPassword: z.string().min(4),
});
