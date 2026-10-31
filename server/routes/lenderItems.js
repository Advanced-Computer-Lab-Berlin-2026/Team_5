import { Router } from "express";
import { getItems, createItem, toggleArchiveItem, updateItem, addItemPhotos } from "../controllers/lenderItemController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadItemPhotos, handleItemPhotoUploadErrors } from "../middleware/uploadItemPhotos.js";


const router = Router();

router.post('/', requireAuth, requireRole('lender'), createItem)
router.get('/', requireAuth, requireRole('lender'), getItems)
router.post('/:id/photos', requireAuth, requireRole('lender'), uploadItemPhotos, addItemPhotos, handleItemPhotoUploadErrors)
router.patch('/:id/archive', requireAuth, requireRole('lender'), toggleArchiveItem)
router.patch('/:id', requireAuth, requireRole('lender'), updateItem)

export default router;