import { ZodError } from "zod";

export const errorHandler = (err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.stack || err.message || err);

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.flatten().fieldErrors,
    });
  }

  // Handle errors with specific status codes (e.g. manually thrown)
  let status = err.status || 500;
  let message = err.message || "An unexpected server error occurred";

  // Handle duplicate key errors from database
  if (err.code === 11000) {
    status = 409;
    message = "A record with this unique identifier already exists";
  }

  return res.status(status).json({
    error: message,
    code: err.code || status,
  });
};
