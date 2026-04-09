import { authService } from '../services/auth.service.js';
import { validate } from '../utils/validation.js';
import {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  confirmPasswordSchema,
} from '../schemas/index.js';

export class AuthController {
  async register(req, res) {
    const data = await validate(registerSchema, req.body);
    const result = await authService.register(
      data.email,
      data.password,
      data.firstName,
      data.lastName
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: result,
    });
  }

  async login(req, res) {
    const data = await validate(loginSchema, req.body);
    const result = await authService.login(data.email, data.password);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  }

  async getProfile(req, res) {
    const user = await authService.getUserById(req.user.id);

    res.status(200).json({
      success: true,
      data: user,
    });
  }

  async forgotPassword(req, res) {
    const data = await validate(resetPasswordSchema, req.body);
    const result = await authService.forgotPassword(data.email);

    res.status(200).json({
      success: true,
      message: result.message,
      ...(result.devResetUrl ? { data: { devResetUrl: result.devResetUrl } } : {}),
    });
  }

  async resetPasswordWithToken(req, res) {
    const data = await validate(confirmPasswordSchema, req.body);
    const result = await authService.resetPassword(data.token, data.password);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  }
}

export const authController = new AuthController();
