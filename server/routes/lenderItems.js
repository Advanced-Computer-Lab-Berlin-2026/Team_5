import { Router } from "express";
import { getItems, createItem } from "../controllers/lenderItemController.js";

const router = Router();

router.post('/', createItem)
router.get('/', getItems)

export default router;