export const errorHandler = (err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || "Server error" });
};
