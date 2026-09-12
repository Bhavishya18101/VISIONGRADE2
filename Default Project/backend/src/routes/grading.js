const express = require('express');
const { query } = require('express-validator');
const { GradingSession, GradingResult } = require('../models');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(protect);

router.get('/history', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { farmer: req.user.id };
    if (req.query.startDate || req.query.endDate) {
      filter.timestamp = {};
      if (req.query.startDate) filter.timestamp.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.timestamp.$lte = new Date(req.query.endDate);
    }

    const [results, total] = await Promise.all([
      GradingResult.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('session', 'sessionId device')
        .populate('booking', 'bookingId cropType'),
      GradingResult.countDocuments(filter),
    ]);

    const formatted = results.map(r => ({
      certificateId: `VG-CERT-${r._id.toString().slice(-8).toUpperCase()}`,
      date: r.timestamp,
      cropType: r.booking?.cropType || 'Onion',
      grade: r.detection.grade,
      quantity: r.detection.weight / 1000,
      pricePerQuintal: getPriceForGrade(r.detection.grade),
      totalAmount: (r.detection.weight / 1000) * getPriceForGrade(r.detection.grade),
    }));

    res.json({
      success: true,
      history: formatted,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/sessions', authorize('admin'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('status').optional().isIn(['initializing', 'running', 'paused', 'completed', 'error']),
], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [sessions, total] = await Promise.all([
      GradingSession.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('device', 'name location')
        .populate('operator', 'name')
        .populate('booking', 'bookingId farmer cropType'),
      GradingSession.countDocuments(filter),
    ]);

    res.json({ success: true, sessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
});

router.get('/sessions/:id', authorize('admin'), async (req, res, next) => {
  try {
    const session = await GradingSession.findById(req.params.id)
      .populate('device', 'name location ip')
      .populate('operator', 'name email')
      .populate('booking', 'bookingId farmer cropType quantity');

    if (!session) {
      return next(new AppError('Session not found', 404));
    }

    const results = await GradingResult.find({ session: session._id })
      .sort({ timestamp: -1 })
      .limit(100);

    res.json({ success: true, session, results });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', authorize('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const match = {};

    if (startDate || endDate) {
      match.timestamp = {};
      if (startDate) match.timestamp.$gte = new Date(startDate);
      if (endDate) match.timestamp.$lte = new Date(endDate);
    }

    const stats = await GradingResult.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$detection.grade',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$detection.confidence' },
          avgWeight: { $avg: '$detection.weight' },
          totalWeight: { $sum: '$detection.weight' },
        },
      },
    ]);

    const dailyStats = await GradingResult.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          totalWeight: { $sum: '$detection.weight' },
          avgConfidence: { $avg: '$detection.confidence' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, stats, dailyStats });
  } catch (error) {
    next(error);
  }
});

function getPriceForGrade(grade) {
  const prices = { A: 2500, B: 1800, C: 1200, Rejected: 0 };
  return prices[grade] || 0;
}

module.exports = router;