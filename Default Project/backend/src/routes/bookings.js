const express = require('express');
const { body, query } = require('express-validator');
const { Booking } = require('../models');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(protect);

router.post('/', [
  body('cropType').isIn(['onion', 'potato', 'tomato', 'garlic', 'ginger']).withMessage('Invalid crop type'),
  body('quantity').isFloat({ min: 0.1, max: 500 }).withMessage('Quantity must be between 0.1 and 500 quintals'),
  body('preferredDate').isISO8601().withMessage('Valid date is required'),
  body('timeSlot').isIn(['06:00-08:00', '08:00-10:00', '10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00']).withMessage('Invalid time slot'),
  body('mandiLocation').isIn(['azadpur', 'vashi', 'yeshwanthpur', 'koyambedu', 'chandigarh']).withMessage('Invalid mandi location'),
  body('vehicleNumber').optional().trim().isLength({ max: 20 }),
  body('notes').optional().trim().isLength({ max: 500 }),
], validate, async (req, res, next) => {
  try {
    const existingBooking = await Booking.findOne({
      farmer: req.user.id,
      preferredDate: req.body.preferredDate,
      timeSlot: req.body.timeSlot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (existingBooking) {
      return next(new AppError('You already have a booking for this time slot', 400));
    }

    const slotBookings = await Booking.countDocuments({
      mandiLocation: req.body.mandiLocation,
      preferredDate: req.body.preferredDate,
      timeSlot: req.body.timeSlot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (slotBookings >= 10) {
      return next(new AppError('This time slot is fully booked', 400));
    }

    const booking = await Booking.create({
      ...req.body,
      farmer: req.user.id,
    });

    const populatedBooking = await Booking.findById(booking._id).populate('farmer', 'name email phone');
    res.status(201).json({ success: true, booking: populatedBooking });
  } catch (error) {
    next(error);
  }
});

router.get('/my', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('status').optional().isIn(['pending', 'confirmed', 'completed', 'cancelled', 'no-show']),
], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { farmer: req.user.id };
    if (req.query.status) filter.status = req.query.status;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ preferredDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('gradingSession', 'sessionId stats status'),
      Booking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/availability', async (req, res, next) => {
  try {
    const { date, mandi } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const filter = {
      preferredDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
    };

    if (mandi) filter.mandiLocation = mandi;

    const bookings = await Booking.find(filter).select('mandiLocation timeSlot');

    const slots = [
      '06:00-08:00', '08:00-10:00', '10:00-12:00',
      '12:00-14:00', '14:00-16:00', '16:00-18:00',
    ];

    const mandis = mandi ? [mandi] : ['azadpur', 'vashi', 'yeshwanthpur', 'koyambedu', 'chandigarh'];

    const availability = mandis.flatMap(m => slots.map(slot => {
      const booked = bookings.filter(b => b.mandiLocation === m && b.timeSlot === slot).length;
      const capacity = 10;
      return {
        mandi: m,
        time: slot,
        booked,
        capacity,
        available: booked < capacity,
      };
    }));

    res.json({ success: true, slots: availability });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('farmer', 'name email phone address')
      .populate('gradingSession', 'sessionId stats status');

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    if (booking.farmer._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }

    res.json({ success: true, booking });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    if (booking.farmer.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return next(new AppError('Cannot cancel this booking', 400));
    }

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = req.body.reason || 'Cancelled by user';
    await booking.save();

    res.json({ success: true, message: 'Booking cancelled' });
  } catch (error) {
    next(error);
  }
});

router.get('/', authorize('admin'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'confirmed', 'completed', 'cancelled', 'no-show']),
  query('date').optional().isISO8601(),
  query('search').optional().trim(),
], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.date) {
      const date = new Date(req.query.date);
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      filter.preferredDate = { $gte: start, $lte: end };
    }
    if (req.query.search) {
      filter.$or = [
        { bookingId: { $regex: req.query.search, $options: 'i' } },
        { 'farmer.name': { $regex: req.query.search, $options: 'i' } },
        { vehicleNumber: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ preferredDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('farmer', 'name email phone')
        .populate('gradingSession', 'sessionId stats'),
      Booking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      bookings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authorize('admin'), [
  body('status').isIn(['pending', 'confirmed', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
], validate, async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    const { status } = req.body;
    booking.status = status;

    if (status === 'confirmed') booking.confirmedAt = new Date();
    if (status === 'completed') booking.completedAt = new Date();
    if (status === 'cancelled') {
      booking.cancelledAt = new Date();
      booking.cancellationReason = req.body.reason || 'Cancelled by admin';
    }

    await booking.save();

    const updated = await Booking.findById(booking._id).populate('farmer', 'name email');
    res.json({ success: true, booking: updated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;