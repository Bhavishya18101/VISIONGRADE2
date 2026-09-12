const express = require('express');
const { query } = require('express-validator');
const { User, Booking, GradingResult, Device } = require('../models');
const { protect, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/stats', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      todayGraded,
      activeFarmers,
      pendingBookings,
      alerts,
      totalVolume,
      revenue,
    ] = await Promise.all([
      GradingResult.aggregate([
        { $match: { timestamp: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$detection.weight' } } },
      ]),
      User.countDocuments({ role: 'farmer', isActive: true, lastLogin: { $gte: new Date(Date.now() - 7 * 86400000) } }),
      Booking.countDocuments({ status: { $in: ['pending', 'confirmed'] } }),
      Device.countDocuments({ status: { $ne: 'online' }, isActive: true }),
      GradingResult.aggregate([{ $group: { _id: null, total: { $sum: '$detection.weight' } } }]),
      GradingResult.aggregate([
        { $group: { _id: null, total: { $sum: { $multiply: ['$detection.weight', { $cond: [{ $eq: ['$detection.grade', 'A'] }, 2500, { $cond: [{ $eq: ['$detection.grade', 'B'] }, 1800, { $cond: [{ $eq: ['$detection.grade', 'C'] }, 1200, 0 }] }] }] } } } } },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        todayGraded: Math.round((todayGraded[0]?.total || 0) / 1000),
        activeFarmers,
        pendingBookings,
        alerts,
        totalVolume: Math.round((totalVolume[0]?.total || 0) / 1000),
        revenue: Math.round(revenue[0]?.total || 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics', async (req, res, next) => {
  try {
    const days = 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [volumeTrend, qualityTrend, leaderboard] = await Promise.all([
      GradingResult.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            volume: { $sum: '$detection.weight' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      GradingResult.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            grades: { $push: '$detection.grade' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      GradingResult.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: '$farmer',
            totalVolume: { $sum: '$detection.weight' },
            sessions: { $sum: 1 },
            grades: { $push: '$detection.grade' },
          },
        },
        { $sort: { totalVolume: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'farmer',
          },
        },
        { $unwind: '$farmer' },
        {
          $project: {
            name: '$farmer.name',
            totalVolume: 1,
            sessions: 1,
            avgGrade: { $arrayElemAt: ['$grades', 0] },
            revenue: {
              $sum: {
                $map: {
                  input: '$grades',
                  as: 'g',
                  in: {
                    $cond: [
                      { $eq: ['$$g', 'A'] },
                      2500,
                      { $cond: [{ $eq: ['$$g', 'B'] }, 1800, { $cond: [{ $eq: ['$$g', 'C'] }, 1200, 0] }] },
                    ],
                  },
                },
              },
            },
          },
        },
      ]),
    ]);

    const qualityFormatted = qualityTrend.map(d => {
      const grades = d.grades;
      const total = grades.length;
      return {
        date: d._id,
        gradeA: total ? Math.round((grades.filter(g => g === 'A').length / total) * 100) : 0,
        gradeB: total ? Math.round((grades.filter(g => g === 'B').length / total) * 100) : 0,
      };
    });

    res.json({
      success: true,
      volumeTrend: volumeTrend.map(d => ({ date: d._id, volume: Math.round(d.volume / 1000) })),
      qualityTrend: qualityFormatted,
      leaderboard,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/activity', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const activities = [];

    const recentBookings = await Booking.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('farmer', 'name');

    recentBookings.forEach(b => {
      activities.push({
        type: 'booking',
        message: `New booking by ${b.farmer.name} - ${b.cropType} ${b.quantity}qt at ${b.mandiName}`,
        timestamp: b.createdAt,
      });
    });

    const recentGradings = await GradingResult.find()
      .sort({ timestamp: -1 })
      .limit(5)
      .populate('farmer', 'name');

    recentGradings.forEach(g => {
      activities.push({
        type: 'grading',
        message: `${g.farmer?.name || 'Farmer'} - Grade ${g.detection.grade} (${(g.detection.confidence * 100).toFixed(0)}%)`,
        timestamp: g.timestamp,
      });
    });

    const recentDevices = await Device.find({ status: { $ne: 'online' } })
      .sort({ updatedAt: -1 })
      .limit(3);

    recentDevices.forEach(d => {
      activities.push({
        type: 'device',
        message: `Device ${d.name} went ${d.status}`,
        timestamp: d.updatedAt,
      });
    });

    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ success: true, activities: activities.slice(0, limit) });
  } catch (error) {
    next(error);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    const [db, aiService] = await Promise.all([
      Promise.resolve({ status: 'healthy' }),
      checkAIService(),
    ]);

    const devices = await Device.find({ isActive: true });
    const onlineDevices = devices.filter(d => d.isOnline()).length;

    res.json({
      success: true,
      health: {
        database: 'healthy',
        ai_service: aiService,
        storage: 'healthy',
        network: onlineDevices > 0 ? 'healthy' : 'warning',
        devices: {
          total: devices.length,
          online: onlineDevices,
          offline: devices.length - onlineDevices,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

async function checkAIService() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${process.env.PYTHON_AI_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok ? 'healthy' : 'unhealthy';
  } catch {
    return 'unhealthy';
  }
}

module.exports = router;