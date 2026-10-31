import { Router } from "express";
<<<<<<< HEAD
import { getItems, createItem, toggleArchiveItem, updateItem } from "../controllers/lenderItemController.js";
=======
import { getItems, createItem, addItemPhotos } from "../controllers/lenderItemController.js";
>>>>>>> origin/SCRUM-231
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadItemPhotos, handleItemPhotoUploadErrors } from "../middleware/uploadItemPhotos.js";


const router = Router();

router.post('/', requireAuth, requireRole('lender'), createItem)
router.get('/', requireAuth, requireRole('lender'), getItems)
<<<<<<< HEAD
router.patch('/:id/archive', requireAuth, requireRole('lender'), toggleArchiveItem)
router.patch('/:id', requireAuth, requireRole('lender'), updateItem)
=======
router.post('/:id/photos', requireAuth, requireRole('lender'), uploadItemPhotos, addItemPhotos, handleItemPhotoUploadErrors)
>>>>>>> origin/SCRUM-231

export default router;