import { ZodError } from 'zod';
import { AppError } from './error-handler.js';

export const validate = async (schema, data) => {
  try {
    return await schema.parseAsync(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw new AppError(400, 'Validation failed', 'VALIDATION_ERROR', messages);
    }
    throw error;
  }
};
