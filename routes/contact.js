import { Router } from 'express';
import { postContact } from '../controllers/contact.controller.js';

const router = Router();

router.post('/', (req, res, next) => postContact(req, res).catch(next));

export default router;
