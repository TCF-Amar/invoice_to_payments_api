import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../utils/prisma.js';
import { ApiError, ApiResponse, asyncHandler } from '../utils/helpers.js';

// Schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().optional(),
  role: z.string().optional().default('admin'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Helper to generate JWT
const generateToken = (id: string, role: string) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod', {
    expiresIn: '30d',
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public (or could be restricted to admins only depending on requirements)
 */
export const registerUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name, role } = registerSchema.parse(req.body);

  // Check if user exists
  const userExists = await prisma.user.findUnique({
    where: { email },
  });

  if (userExists) {
    throw new ApiError(400, 'User already exists');
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role,
    },
  });

  if (user) {
    res.status(201).json(
      new ApiResponse(201, 'User registered successfully', {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        token: generateToken(user.id, user.role),
      })
    );
  } else {
    throw new ApiError(400, 'Invalid user data');
  }
});

/**
 * @desc    Authenticate a user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  // Check for user email
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }

  // Check password
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    throw new ApiError(401, 'Invalid credentials');
  }

  res.json(
    new ApiResponse(200, 'Login successful', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token: generateToken(user.id, user.role),
    })
  );
});

/**
 * @desc    Get user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  // req.user is set by the protect middleware
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (user) {
    res.json(new ApiResponse(200, 'User profile fetched', user));
  } else {
    throw new ApiError(404, 'User not found');
  }
});
