import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/helpers.js';

/**
 * Middleware to validate API Key
 * Checks for 'x-api-key' header against 'API_SECRET' in .env
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  const secret = process.env.API_SECRET;

  if (!secret) {
    console.error('❌ API_SECRET is not defined in environment variables');
    return next(new ApiError(500, 'Server configuration error'));
  }

  if (!apiKey || apiKey !== secret) {
    return next(new ApiError(401, 'Unauthorized: Access denied'));
  }

  next();
};
