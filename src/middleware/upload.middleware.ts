import multer from 'multer';
import { ApiError } from '../utils/helpers.js';

// Use memory storage to avoid writing to disk
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, 
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'Invalid file type. Only PDF, JPEG, JPG, and PNG are allowed.') as any, false);
    }
  },
});

export const uploadMiddleware = upload.single('file');
