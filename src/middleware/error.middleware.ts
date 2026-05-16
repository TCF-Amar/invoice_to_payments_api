import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/helpers.js';
import { ZodError } from 'zod';

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((e: any) => ({
        field: e.path.join('.'),
        message: e.message
      }))
    });
  }

  // Prisma unique constraint
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `Duplicate entry — ${field} already exists`,
    });
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found',
    });
  }

  // Prisma column not found (schema mismatch)
  if (err.code === 'P2022') {
    console.error('Prisma Schema Mismatch (P2022):', err.message);
    return res.status(500).json({
      success: false,
      message: 'Database schema mismatch. Please run migrations.',
    });
  }

  // Prisma foreign key constraint
  if (err.code === 'P2003') {
    return res.status(400).json({
      success: false,
      message: 'Foreign key constraint failed. Related record not found.',
    });
  }

  // Custom ApiError
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors
    });
  }

  // Generic error
  console.error('Unhandled Server Error:', err);
  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
};
