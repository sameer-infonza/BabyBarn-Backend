import { authService } from '../services/auth.service.js';
import { validate } from '../utils/validation.js';
import {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  confirmPasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  changePasswordSchema,
  addressCreateSchema,
  addressUpdateSchema,
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
      data: result,
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

  async verifyEmail(req, res) {
    const data = await validate(verifyEmailSchema, req.query);
    const result = await authService.verifyEmail(data.token);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  }

  async resendVerification(req, res) {
    const data = await validate(resetPasswordSchema, req.body);
    const result = await authService.resendVerification(data.email);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  }

  async updateProfile(req, res) {
    const data = await validate(updateProfileSchema, req.body);
    const result = await authService.updateProfile(req.user.id, data);
    res.status(200).json({ success: true, message: 'Profile updated', data: result });
  }

  async changePassword(req, res) {
    const data = await validate(changePasswordSchema, req.body);
    const result = await authService.changePassword(req.user.id, data.currentPassword, data.newPassword);
    res.status(200).json({ success: true, message: result.message, data: result });
  }

  async listAddresses(req, res) {
    const items = await authService.listAddresses(req.user.id);
    res.status(200).json({ success: true, data: items });
  }

  async createAddress(req, res) {
    const data = await validate(addressCreateSchema, req.body);
    const result = await authService.createAddress(req.user.id, data);
    res.status(201).json({ success: true, message: 'Address created', data: result });
  }

  async updateAddress(req, res) {
    const data = await validate(addressUpdateSchema, req.body);
    const result = await authService.updateAddress(req.user.id, req.params.addressId, data);
    res.status(200).json({ success: true, message: result.message, data: result });
  }

  async deleteAddress(req, res) {
    const result = await authService.deleteAddress(req.user.id, req.params.addressId);
    res.status(200).json({ success: true, message: result.message, data: result });
  }
}

export const authController = new AuthController();
