import { Router } from 'express';
import { addToWishlist, removeFromWishlist, getWishlist } from '../controllers/wishlistController.js';


const router = Router();

//define my routes here
router.post('/:itemId', addToWishlist);
router.delete('/:itemId', removeFromWishlist);
router.get('/', getWishlist);

export default router;
