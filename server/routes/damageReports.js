import { Router } from 'express';
import { disputeDamageCase, downloadDamageCasePdf } from '../controllers/damageReportController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadItemPhotos, handleItemPhotoUploadErrors } from '../middleware/uploadItemPhotos.js';

const router = Router();

// :id is the case number, the id of the lender's damage report (DMG-xxxxxxxx).
// Who may use each route (the borrower; admins, borrower and lender) is checked in the controller.
router.post('/:id/dispute', requireAuth, uploadItemPhotos, disputeDamageCase, handleItemPhotoUploadErrors);
router.get('/:id/pdf', requireAuth, downloadDamageCasePdf);

export default router;
