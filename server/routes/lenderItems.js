import { Router } from "express";
import { getItems, createItem, addItemPhotos } from "../controllers/lenderItemController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadItemPhotos, handleItemPhotoUploadErrors } from "../middleware/uploadItemPhotos.js";


const router = Router();

router.post('/', requireAuth, requireRole('lender'), createItem)
router.get('/', getItems)
router.post('/:id/photos', requireAuth, requireRole('lender'), uploadItemPhotos, addItemPhotos, handleItemPhotoUploadErrors)

export default router;