require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const connectDB = require('./config/database');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { protect } = require('./middleware/auth');
const { User, Booking, GradingResult, Device, GradingSession } = require('./models');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(express.static(path.join(__dirname, '../../frontend')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/login.html'));
});

app.use(errorHandler);

const connectedClients = new Map();
const deviceSockets = new Map();

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new Error('User not found'));
    }
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.user.email} (${socket.user.role})`);
  connectedClients.set(socket.id, { socket, user: socket.user, subscriptions: new Set() });

  socket.on('subscribe', (data) => {
    const client = connectedClients.get(socket.id);
    if (client && data.channels) {
      data.channels.forEach(channel => {
        client.subscriptions.add(channel);
        socket.join(channel);
      });
    }
  });

  socket.on('unsubscribe', (data) => {
    const client = connectedClients.get(socket.id);
    if (client && data.channels) {
      data.channels.forEach(channel => {
        client.subscriptions.delete(channel);
        socket.leave(channel);
      });
    }
  });

  socket.on('device_heartbeat', async (data) => {
    try {
      const device = await Device.findOne({ deviceId: data.deviceId });
      if (device) {
        device.lastHeartbeat = new Date();
        device.lastSeen = new Date();
        device.status = 'online';
        if (data.metrics) device.metrics = { ...device.metrics, ...data.metrics };
        if (data.cameras) device.cameras = data.cameras;
        await device.save();

        deviceSockets.set(device.deviceId, socket.id);

        broadcastToChannel('telemetry', {
          type: 'device_status',
          data: { deviceId: device.deviceId, status: 'online', metrics: device.metrics },
        });
      }
    } catch (error) {
      console.error('Device heartbeat error:', error);
    }
  });

  socket.on('grading_result', async (data) => {
    try {
      if (socket.user.role !== 'admin' && socket.user.role !== 'device') return;

      const session = await GradingSession.findOne({ sessionId: data.sessionId });
      if (!session) return;

      const result = await GradingResult.create({
        session: session._id,
        booking: session.booking,
        farmer: session.booking ? (await Booking.findById(session.booking)).farmer : null,
        imageUrl: data.imageUrl,
        detection: data.detection,
        qualityMetrics: data.qualityMetrics,
        processedBy: data.processedBy || 'edge-ai',
        inferenceTime: data.inferenceTime,
      });

      session.totalProcessed += 1;
      session.stats[`grade${data.detection.grade}`] = (session.stats[`grade${data.detection.grade}`] || 0) + 1;
      session.stats.totalWeight += data.detection.weight || 0;
      session.stats.avgConfidence = ((session.stats.avgConfidence * (session.totalProcessed - 1)) + data.detection.confidence) / session.totalProcessed;
      session.stats.avgInferenceTime = ((session.stats.avgInferenceTime * (session.totalProcessed - 1)) + (data.inferenceTime || 0)) / session.totalProcessed;
      await session.save();

      broadcastToChannel('grading', {
        type: 'grading_result',
        data: {
          detection: data.detection,
          sessionStats: session.stats,
          recentDetections: await getRecentDetections(session._id),
        },
      });

      if (session.booking) {
        broadcastToChannel('bookings', {
          type: 'booking_update',
          data: { bookingId: session.booking.toString() },
        });
      }
    } catch (error) {
      console.error('Grading result error:', error);
    }
  });

  socket.on('start_grading', async (data) => {
    try {
      const session = await GradingSession.findOne({ sessionId: data.sessionId });
      if (session) {
        session.status = 'running';
        session.startTime = new Date();
        await session.save();

        broadcastToChannel('grading', {
          type: 'session_started',
          data: { sessionId: session.sessionId },
        });
      }
    } catch (error) {
      console.error('Start grading error:', error);
    }
  });

  socket.on('stop_grading', async (data) => {
    try {
      const session = await GradingSession.findOne({ sessionId: data.sessionId });
      if (session) {
        session.status = 'completed';
        session.endTime = new Date();
        await session.save();

        broadcastToChannel('grading', {
          type: 'session_completed',
          data: { sessionId: session.sessionId, stats: session.stats },
        });
      }
    } catch (error) {
      console.error('Stop grading error:', error);
    }
  });

  socket.on('get_cameras', async () => {
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

      socket.emit('camera_list', cameras);
    } catch (error) {
      console.error('Get cameras error:', error);
    }
  });

  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`Client disconnected: ${socket.user.email}`);
  });
});

function broadcastToChannel(channel, message) {
  io.to(channel).emit('message', message);
}

async function getRecentDetections(sessionId, limit = 10) {
  return GradingResult.find({ session: sessionId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('detection timestamp');
}

setInterval(async () => {
  try {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 60000);

    const staleDevices = await Device.find({
      isActive: true,
      status: 'online',
      lastHeartbeat: { $lt: staleThreshold },
    });

    for (const device of staleDevices) {
      device.status = 'offline';
      await device.save();

      broadcastToChannel('telemetry', {
        type: 'device_status',
        data: { deviceId: device.deviceId, status: 'offline' },
      });
    }

    const telemetryData = await generateTelemetryData();
    broadcastToChannel('telemetry', {
      type: 'telemetry',
      data: telemetryData,
    });
  } catch (error) {
    console.error('Periodic broadcast error:', error);
  }
}, 10000);

async function generateTelemetryData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [throughput, grades, mandi, devices, stats] = await Promise.all([
    GradingResult.aggregate([
      { $match: { timestamp: { $gte: today } } },
      {
        $group: {
          _id: { $hour: '$timestamp' },
          volume: { $sum: '$detection.weight' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    GradingResult.aggregate([
      { $match: { timestamp: { $gte: today } } },
      { $group: { _id: '$detection.grade', count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { preferredDate: { $gte: today }, status: { $in: ['confirmed', 'completed'] } } },
      { $group: { _id: '$mandiLocation', count: { $sum: 1 } } },
    ]),
    Device.find({ isActive: true }).select('deviceId name location status metrics lastHeartbeat'),
    GradingResult.aggregate([
      { $match: { timestamp: { $gte: today } } },
      {
        $group: {
          _id: null,
          totalProcessed: { $sum: 1 },
          totalWeight: { $sum: '$detection.weight' },
          avgConfidence: { $avg: '$detection.confidence' },
        },
      },
    ]),
  ]);

  return {
    throughput: {
      labels: throughput.map(t => `${t._id}:00`),
      values: throughput.map(t => Math.round(t.volume / 1000)),
    },
    grades: grades.reduce((acc, g) => ({ ...acc, [g._id.toLowerCase()]: g.count }), {}),
    mandi: {
      labels: mandi.map(m => m._id),
      values: mandi.map(m => m.count),
    },
    devices: devices.map(d => ({
      deviceId: d.deviceId,
      name: d.name,
      location: d.location,
      status: d.status,
      online: d.isOnline(),
      metrics: d.metrics,
      lastSeen: d.lastHeartbeat,
    })),
    stats: {
      totalProcessed: stats[0]?.totalProcessed || 0,
      totalWeight: Math.round((stats[0]?.totalWeight || 0) / 1000),
      avgConfidence: Math.round((stats[0]?.avgConfidence || 0) * 100),
    },
  };
}

const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3001;

const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server running on port ${WS_PORT}`);
  });
};

startServer();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, server, io };