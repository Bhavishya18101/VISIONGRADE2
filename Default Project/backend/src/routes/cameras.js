const express = require('express');
const { Device } = require('../models');
const { protect, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(protect);

router.get('/', authorize('admin'), async (req, res, next) => {
  try {
    const devices = await Device.find({ isActive: true, status: 'online' }).select('cameras name deviceId');
    const cameras = [];

    devices.forEach(device => {
      device.cameras.forEach((cam, idx) => {
        if (cam.status === 'active') {
          cameras.push({
            id: `${device.deviceId}_cam${idx + 1}`,
            deviceId: device.deviceId,
            deviceName: device.name,
            name: cam.name || `Camera ${idx + 1}`,
            resolution: cam.resolution,
            fps: cam.fps,
          });
        }
      });
    });

    res.json({ success: true, cameras });
  } catch (error) {
    next(error);
  }
});

router.get('/:cameraId/stream', async (req, res, next) => {
  try {
    const [deviceId, camIndex] = req.params.cameraId.split('_cam');
    const device = await Device.findOne({ deviceId });

    if (!device) {
      return next(new AppError('Device not found', 404));
    }

    const camIdx = parseInt(camIndex) - 1;
    const camera = device.cameras[camIdx];

    if (!camera || camera.status !== 'active') {
      return next(new AppError('Camera not available', 404));
    }

    res.json({
      success: true,
      streamUrl: `http://${device.ip}:8080/stream/${camIdx}`,
      deviceId: device.deviceId,
      cameraId: camera.cameraId || `cam${camIdx}`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;