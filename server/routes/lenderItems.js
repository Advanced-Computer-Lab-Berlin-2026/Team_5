import { Router } from "express";
import { getItems, createItem } from "../controllers/lenderItemController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";


const router = Router();

router.post('/', requireAuth, requireRole('lender'), createItem)
router.get('/', requireAuth, requireRole('lender'), getItems)

export default router;