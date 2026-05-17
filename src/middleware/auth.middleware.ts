import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError, asyncHandler } from '../utils/helpers.js';
import prisma from '../utils/prisma.js';

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

interface JwtPayload {
  id: string;
  role: string;
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: any; // You can type this properly with the User model if needed
    }
  }
}

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      if (!token || token === 'null' || token === 'undefined') {
        throw new ApiError(401, 'Not authorized, no token provided');
      }

      // Verify token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod'
      ) as JwtPayload;

      // Get user from the token
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, role: true }, // Exclude password
      });

      if (!user) {
        throw new ApiError(401, 'Not authorized, user not found');
      }

      req.user = user;
      next();
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(401, 'Not authorized, token failed');
    }
  }

  if (!token) {
    throw new ApiError(401, 'Not authorized, no token');
  }
});

// Role-based authorization middleware
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError(
        403,
        `User role '${req.user?.role}' is not authorized to access this route`
      );
    }
    next();
  };
};
