import { Router } from 'express';
import { addToWishlist, removeFromWishlist, getWishlist } from '../controllers/wishlistController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

//define my routes here
router.post('/:itemId', requireAuth, addToWishlist);
router.delete('/:itemId', requireAuth, removeFromWishlist);
router.get('/', requireAuth, getWishlist);

export default router;
