import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../http/HttpError.js';

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      message: error.message,
      details: error.details
    });
    return;
  }

  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
};
