import { Router } from 'express';
import {
	listIncomingReservations,
	approveReservation,
	rejectReservation,
	markPickedUp,
	markReturnedGood,
	addConditionPhotos,
	reportDamage, listPendingExtensionRequests, decideReservationExtension,
} from '../controllers/lenderReservationController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadItemPhotos, handleItemPhotoUploadErrors } from '../middleware/uploadItemPhotos.js';

const router = Router();

router.get('/', requireAuth, requireRole('lender'), listIncomingReservations);
router.patch('/:id/approve', requireAuth, requireRole('lender'), approveReservation);
router.patch('/:id/reject', requireAuth, requireRole('lender'), rejectReservation);
router.patch('/:id/pickup', requireAuth, requireRole('lender'), markPickedUp);
router.patch('/:id/return', requireAuth, requireRole('lender'), markReturnedGood);
router.post('/:id/photos/:stage', requireAuth, requireRole('lender'), uploadItemPhotos, addConditionPhotos, handleItemPhotoUploadErrors);
router.post('/:id/damage', requireAuth, requireRole('lender'), uploadItemPhotos, reportDamage, handleItemPhotoUploadErrors);
router.get('/extensions/pending',requireAuth,requireRole('lender'),listPendingExtensionRequests);
router.patch('/:id/extensions/:requestId',requireAuth,requireRole('lender'),decideReservationExtension);
export default router;
