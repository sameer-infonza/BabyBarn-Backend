import { z } from 'zod';
import { validate } from '../utils/validation.js';
import { emailService } from '../services/email.service.js';

const contactSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10000),
});

export async function postContact(req, res) {
  const data = await validate(contactSchema, req.body);
  await emailService.sendContactInquiry({
    fromName: data.fullName,
    fromEmail: data.email,
    subjectLine: data.subject,
    message: data.message,
  });

  res.status(200).json({
    success: true,
    message: 'Your message has been sent.',
  });
}
