const express = require('express');
const { body, query } = require('express-validator');
const { Device } = require('../models');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('status').optional().isIn(['online', 'offline', 'maintenance', 'error']),
], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { isActive: true };
    if (req.query.status) filter.status = req.query.status;

    const [devices, total] = await Promise.all([
      Device.find(filter).sort({ lastHeartbeat: -1 }).skip(skip).limit(limit),
      Device.countDocuments(filter),
    ]);

    const formatted = devices.map(d => ({
      ...d.toObject(),
      online: d.isOnline(),
    }));

    res.json({ success: true, devices: formatted, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
});

router.post('/', [
  body('deviceId').trim().notEmpty().withMessage('Device ID is required'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('ip').isIP().withMessage('Valid IP address is required'),
  body('model').optional().trim(),
  body('firmware').optional().trim(),
  body('specs.cpu').optional().trim(),
  body('specs.memory').optional().trim(),
  body('specs.storage').optional().trim(),
  body('specs.gpu').optional().trim(),
  body('specs.os').optional().trim(),
  body('cameras').optional().isArray(),
], validate, async (req, res, next) => {
  try {
    const existing = await Device.findOne({ $or: [{ deviceId: req.body.deviceId }, { ip: req.body.ip }] });
    if (existing) {
      return next(new AppError('Device with this ID or IP already exists', 400));
    }

    const device = await Device.create({
      ...req.body,
      registeredBy: req.user.id,
    });

    res.status(201).json({ success: true, device });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) {
      return next(new AppError('Device not found', 404));
    }
    res.json({ success: true, device: { ...device.toObject(), online: device.isOnline() } });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', [
  body('name').optional().trim().notEmpty(),
  body('location').optional().trim().notEmpty(),
  body('status').optional().isIn(['online', 'offline', 'maintenance', 'error']),
  body('firmware').optional().trim(),
  body('specs').optional().isObject(),
  body('cameras').optional().isArray(),
], validate, async (req, res, next) => {
  try {
    const device = await Device.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!device) {
      return next(new AppError('Device not found', 404));
    }
    res.json({ success: true, device });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const { metrics, cameras } = req.body;
    const device = await Device.findById(req.params.id);
    if (!device) {
      return next(new AppError('Device not found', 404));
    }

    device.lastHeartbeat = new Date();
    device.lastSeen = new Date();
    device.status = 'online';

    if (metrics) {
      device.metrics = { ...device.metrics, ...metrics };
    }

    if (cameras) {
      device.cameras = cameras;
    }

    await device.save();
    res.json({ success: true, device: { ...device.toObject(), online: true } });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/restart', async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) {
      return next(new AppError('Device not found', 404));
    }

    device.status = 'maintenance';
    await device.save();

    res.json({ success: true, message: 'Restart command queued' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const device = await Device.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!device) {
      return next(new AppError('Device not found', 404));
    }
    res.json({ success: true, message: 'Device deactivated' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;