import { Router } from 'express';
import * as authCtrl from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

// Public routes
router.post('/register', authCtrl.registerUser);
router.post('/login', authCtrl.loginUser);

// Protected routes
router.get('/me', protect, authCtrl.getUserProfile);

export default router;
