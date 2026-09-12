const express = require('express');
const authRoutes = require('./auth');
const bookingRoutes = require('./bookings');
const gradingRoutes = require('./grading');
const adminRoutes = require('./admin');
const deviceRoutes = require('./devices');
const cameraRoutes = require('./cameras');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/bookings', bookingRoutes);
router.use('/grading', gradingRoutes);
router.use('/admin', adminRoutes);
router.use('/devices', deviceRoutes);
router.use('/cameras', cameraRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;