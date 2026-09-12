const mongoose = require('mongoose');

const gradingResultSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GradingSession',
    required: true,
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
  },
  farmer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  imageUrl: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },
  detection: {
    grade: {
      type: String,
      enum: ['A', 'B', 'C', 'Rejected'],
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    size: Number,
    weight: Number,
    defects: [String],
    boundingBox: {
      x: Number,
      y: Number,
      width: Number,
      height: Number,
    },
  },
  qualityMetrics: {
    colorScore: Number,
    shapeScore: Number,
    surfaceScore: Number,
    sizeScore: Number,
  },
  processedBy: String,
  inferenceTime: Number,
}, { timestamps: true });

const gradingSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    unique: true,
    required: true,
  },
  device: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true,
  },
  camera: String,
  operator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
  },
  status: {
    type: String,
    enum: ['initializing', 'running', 'paused', 'completed', 'error'],
    default: 'initializing',
  },
  startTime: Date,
  endTime: Date,
  totalProcessed: {
    type: Number,
    default: 0,
  },
  stats: {
    gradeA: { type: Number, default: 0 },
    gradeB: { type: Number, default: 0 },
    gradeC: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    avgInferenceTime: { type: Number, default: 0 },
  },
  error: String,
}, { timestamps: true });

gradingSessionSchema.pre('save', async function(next) {
  if (!this.sessionId) {
    this.sessionId = `GRD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  }
  next();
});

gradingResultSchema.index({ session: 1, timestamp: -1 });
gradingResultSchema.index({ farmer: 1, timestamp: -1 });
gradingResultSchema.index({ 'detection.grade': 1 });

module.exports = {
  GradingSession: mongoose.model('GradingSession', gradingSessionSchema),
  GradingResult: mongoose.model('GradingResult', gradingResultSchema),
};